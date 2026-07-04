// Accounts, friends, invites, and WebRTC signaling over Firebase.
// Usernames are randomly generated callsigns (rerollable, never user-typed).
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

const ADJ = ['IRON', 'CRIMSON', 'GHOST', 'NIGHT', 'STEEL', 'VOID', 'RAPID', 'SILENT',
  'ROGUE', 'DELTA', 'ONYX', 'SOLAR', 'FERAL', 'PRIME', 'ZERO', 'ASH',
  'COBALT', 'RUST', 'NOVA', 'GRIM', 'HOLLOW', 'STATIC', 'DUSK', 'APEX'];
const NOUN = ['VIPER', 'FALCON', 'WOLF', 'RAVEN', 'JACKAL', 'MANTIS', 'HORNET', 'LYNX',
  'COBRA', 'BADGER', 'SHRIKE', 'PANTHER', 'HAWK', 'SPECTRE', 'HYDRA', 'MOTH',
  'TALON', 'REAPER', 'WARDEN', 'DRIFTER', 'SABLE', 'PIKE', 'ORYX', 'VULTURE'];

function randomCallsign() {
  const a = ADJ[(Math.random() * ADJ.length) | 0];
  const n = NOUN[(Math.random() * NOUN.length) | 0];
  const d = 10 + ((Math.random() * 90) | 0);
  return `${a}-${n}-${d}`;
}

class Net {
  constructor() {
    this.enabled = false;
    this.user = null;
    this.profile = null;
    this.authListeners = [];
    this._unsubs = [];
    this.fb = null;
  }

  async init() {
    if (!FIREBASE_CONFIG) return false;
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js'),
        import(SDK + 'firebase-firestore.js'),
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      // named database (the project's (default) db belongs to other apps)
      this.fb = { auth: authMod, fs: fsMod, authInst: authMod.getAuth(app), db: fsMod.getFirestore(app, 'blacksite') };
      this.enabled = true;
      this.fb.auth.onAuthStateChanged(this.fb.authInst, async user => {
        this.user = user;
        let err = null;
        try {
          this.profile = user ? await this.ensureProfile(user) : null;
        } catch (e) {
          // e.g. Firestore missing or rules not published — surface, don't hang
          console.warn('profile load failed:', e);
          this.profile = null;
          err = e;
        }
        for (const cb of this.authListeners) cb(this.user, this.profile, err);
      });
      return true;
    } catch (e) {
      console.warn('Firebase init failed:', e);
      return false;
    }
  }

  onAuth(cb) { this.authListeners.push(cb); }

  async signIn() {
    const { GoogleAuthProvider, signInWithPopup } = this.fb.auth;
    await signInWithPopup(this.fb.authInst, new GoogleAuthProvider());
  }

  async signOut() {
    try { await this.leavePvpQueue(); await this.setStatus('offline'); } catch { }
    await this.fb.auth.signOut(this.fb.authInst);
  }

  // ---- profile / username ----

  async ensureProfile(user) {
    const { doc, getDoc } = this.fb.fs;
    const ref = doc(this.fb.db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const username = await this.claimUsername(user.uid);
    const data = { username, createdAt: Date.now() };
    await this.fb.fs.setDoc(ref, data);
    return data;
  }

  // transactionally claim a unique random callsign
  async claimUsername(uid, oldName = null) {
    const { doc, runTransaction } = this.fb.fs;
    for (let tries = 0; tries < 8; tries++) {
      const name = randomCallsign();
      try {
        await runTransaction(this.fb.db, async tx => {
          const nameRef = doc(this.fb.db, 'usernames', name);
          const existing = await tx.get(nameRef);
          if (existing.exists()) throw new Error('taken');
          tx.set(nameRef, { uid });
          if (oldName) tx.delete(doc(this.fb.db, 'usernames', oldName));
        });
        return name;
      } catch (e) {
        if (e.message !== 'taken') throw e;
      }
    }
    // 8 collisions in a 57k namespace — effectively impossible, but be safe
    return `OPERATIVE-${uid.slice(0, 6).toUpperCase()}`;
  }

  async rerollUsername() {
    if (!this.user || !this.profile) return null;
    const { doc, updateDoc } = this.fb.fs;
    const newName = await this.claimUsername(this.user.uid, this.profile.username);
    await updateDoc(doc(this.fb.db, 'users', this.user.uid), { username: newName });
    this.profile.username = newName;
    return newName;
  }

  async deleteAccount() {
    if (!this.user) return;
    const { doc, deleteDoc } = this.fb.fs;
    const uid = this.user.uid;
    await this.leavePvpQueue();
    try {
      if (this.profile?.username) await deleteDoc(doc(this.fb.db, 'usernames', this.profile.username));
      await deleteDoc(doc(this.fb.db, 'users', uid));
    } catch (e) { console.warn('profile cleanup:', e); }
    try {
      await this.fb.auth.deleteUser(this.fb.authInst.currentUser);
    } catch (e) {
      if (e.code === 'auth/requires-recent-login') {
        await this.signIn();
        await this.fb.auth.deleteUser(this.fb.authInst.currentUser);
      } else throw e;
    }
  }

  // ---- friends ----

  async findUserByName(username) {
    const { doc, getDoc } = this.fb.fs;
    const snap = await getDoc(doc(this.fb.db, 'usernames', username.trim().toUpperCase()));
    return snap.exists() ? snap.data().uid : null;
  }

  async sendFriendRequest(username) {
    const uid = await this.findUserByName(username);
    if (!uid) return 'not-found';
    if (uid === this.user.uid) return 'self';
    const { doc, setDoc } = this.fb.fs;
    await setDoc(doc(this.fb.db, 'users', uid, 'requests', this.user.uid),
      { username: this.profile.username, at: Date.now() });
    return 'sent';
  }

  async acceptRequest(fromUid, fromName) {
    const { doc, setDoc, deleteDoc } = this.fb.fs;
    const me = this.user.uid;
    await setDoc(doc(this.fb.db, 'users', me, 'friends', fromUid), { username: fromName, since: Date.now() });
    await setDoc(doc(this.fb.db, 'users', fromUid, 'friends', me), { username: this.profile.username, since: Date.now() });
    await deleteDoc(doc(this.fb.db, 'users', me, 'requests', fromUid));
  }

  async declineRequest(fromUid) {
    const { doc, deleteDoc } = this.fb.fs;
    await deleteDoc(doc(this.fb.db, 'users', this.user.uid, 'requests', fromUid));
  }

  listenFriends(cb) {
    const { collection, onSnapshot } = this.fb.fs;
    const unsub = onSnapshot(collection(this.fb.db, 'users', this.user.uid, 'friends'),
      snap => cb(snap.docs.map(d => ({ uid: d.id, ...d.data() }))));
    this._unsubs.push(unsub);
    return unsub;
  }

  listenRequests(cb) {
    const { collection, onSnapshot } = this.fb.fs;
    const unsub = onSnapshot(collection(this.fb.db, 'users', this.user.uid, 'requests'),
      snap => cb(snap.docs.map(d => ({ uid: d.id, ...d.data() }))));
    this._unsubs.push(unsub);
    return unsub;
  }

  // ---- presence (friends can see what you're doing) ----

  async setStatus(status, joinCode = null) {
    if (!this.enabled || !this.user) return;
    this._lastStatus = status;
    this._lastCode = joinCode;
    const { doc, updateDoc } = this.fb.fs;
    try {
      await updateDoc(doc(this.fb.db, 'users', this.user.uid),
        { status, joinCode, statusAt: Date.now() });
    } catch (e) { /* best-effort */ }
  }

  // keep statusAt fresh so friends can tell live status from a closed tab
  startHeartbeat() {
    if (this._hb) return;
    this._hb = setInterval(() => {
      if (this.user && this._lastStatus) this.setStatus(this._lastStatus, this._lastCode);
    }, 60 * 1000);
  }

  listenFriendStatuses(uids, cb) {
    const { doc, onSnapshot } = this.fb.fs;
    for (const u of this._statusUnsubs ?? []) u();
    this._statusUnsubs = [];
    const statuses = {};
    for (const uid of uids) {
      const unsub = onSnapshot(doc(this.fb.db, 'users', uid), snap => {
        const d = snap.data();
        if (d) statuses[uid] = { status: d.status, statusAt: d.statusAt, joinCode: d.joinCode };
        cb(statuses);
      });
      this._statusUnsubs.push(unsub);
    }
  }

  // ---- pvp matchmaking queue ----

  async enterPvpQueue(code) {
    const { doc, setDoc } = this.fb.fs;
    const at = Date.now();
    await setDoc(doc(this.fb.db, 'queue', this.user.uid),
      { uid: this.user.uid, username: this.profile.username, code, at });
    return at;
  }

  async leavePvpQueue() {
    if (!this.enabled || !this.user) return;
    const { doc, deleteDoc } = this.fb.fs;
    try { await deleteDoc(doc(this.fb.db, 'queue', this.user.uid)); } catch { }
  }

  // atomically claim a specific queued player; returns their entry or null
  async claimQueueByUid(uid) {
    const { doc, runTransaction } = this.fb.fs;
    try {
      let entry = null;
      await runTransaction(this.fb.db, async tx => {
        const ref = doc(this.fb.db, 'queue', uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('gone');
        entry = snap.data();
        tx.delete(ref);
      });
      return entry;
    } catch { return null; }
  }

  // claim the longest-waiting fresh opponent. olderThan limits the scan to
  // entries queued before our own so simultaneous searchers pair one-way.
  async claimPvpOpponent(olderThan = Infinity) {
    const { collection, query, where, getDocs } = this.fb.fs;
    const snap = await getDocs(query(collection(this.fb.db, 'queue'),
      where('at', '>', Date.now() - 5 * 60 * 1000)));
    const entries = snap.docs.map(d => d.data())
      .filter(e => e.uid !== this.user.uid && e.at < olderThan)
      .sort((a, b) => a.at - b.at);
    for (const e of entries) {
      const claimed = await this.claimQueueByUid(e.uid);
      if (claimed) return claimed;
    }
    return null;
  }

  // ---- co-op invites ----

  async sendInvite(friendUid, code) {
    const { doc, setDoc } = this.fb.fs;
    await setDoc(doc(this.fb.db, 'users', friendUid, 'invites', this.user.uid),
      { code, username: this.profile.username, at: Date.now() });
  }

  listenInvites(cb) {
    const { collection, onSnapshot } = this.fb.fs;
    const TTL = 24 * 60 * 60 * 1000;
    const unsub = onSnapshot(collection(this.fb.db, 'users', this.user.uid, 'invites'), snap => {
      const invites = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      // expired invites: hide them and delete the docs so they don't pile up
      for (const i of invites) {
        if (Date.now() - i.at >= TTL) this.clearInvite(i.uid).catch(() => {});
      }
      cb(invites.filter(i => Date.now() - i.at < TTL));
    });
    this._unsubs.push(unsub);
    return unsub;
  }

  async clearInvite(fromUid) {
    const { doc, deleteDoc } = this.fb.fs;
    await deleteDoc(doc(this.fb.db, 'users', this.user.uid, 'invites', fromUid));
  }

  // ---- WebRTC rooms (Firestore signaling) ----

  _newPC() {
    return new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    });
  }

  // delete a room doc plus its ICE-candidate subcollections (no cascade in Firestore)
  async _deleteRoom(code) {
    const { doc, deleteDoc, collection, getDocs } = this.fb.fs;
    const roomRef = doc(this.fb.db, 'rooms', code);
    try {
      for (const sub of ['hostCand', 'guestCand']) {
        const snap = await getDocs(collection(roomRef, sub));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      }
      await deleteDoc(roomRef);
    } catch (e) { console.warn('room cleanup:', e); }
  }

  // sweep leftovers: my own rooms from prior sessions, and anyone's older than a day
  async _sweepStaleRooms() {
    const { collection, query, where, getDocs } = this.fb.fs;
    const rooms = collection(this.fb.db, 'rooms');
    try {
      const [mine, old] = await Promise.all([
        getDocs(query(rooms, where('hostUid', '==', this.user.uid))),
        getDocs(query(rooms, where('at', '<', Date.now() - 24 * 60 * 60 * 1000))),
      ]);
      const codes = new Set([...mine.docs, ...old.docs].map(d => d.id));
      await Promise.all([...codes].map(c => this._deleteRoom(c)));
    } catch (e) { console.warn('room sweep:', e); }
  }

  // Host: create room, return {code, channel: Promise<RTCDataChannel>}
  async hostRoom(seed) {
    const { doc, setDoc, updateDoc, onSnapshot, collection, addDoc } = this.fb.fs;
    await this._sweepStaleRooms();
    const code = Array.from({ length: 5 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join('');
    const roomRef = doc(this.fb.db, 'rooms', code);
    const pc = this._newPC();
    const dc = pc.createDataChannel('game', { ordered: true });

    pc.onicecandidate = e => {
      if (e.candidate) addDoc(collection(roomRef, 'hostCand'), e.candidate.toJSON());
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(roomRef, {
      hostUid: this.user.uid, hostName: this.profile.username,
      seed, offer: { type: offer.type, sdp: offer.sdp }, at: Date.now(),
    });

    const unsubAns = onSnapshot(roomRef, async snap => {
      const data = snap.data();
      if (data?.answer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });
    const unsubCand = onSnapshot(collection(roomRef, 'guestCand'), snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'added') pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(() => {});
      });
    });
    this._unsubs.push(unsubAns, unsubCand);

    const channel = new Promise((resolve, reject) => {
      dc.onopen = () => {
        // connected — signaling is done: stop candidate writes/listeners, remove the room
        pc.onicecandidate = null;
        unsubAns(); unsubCand();
        this._deleteRoom(code);
        resolve(dc);
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) reject(new Error(pc.connectionState));
      };
    });
    return { code, channel, pc };
  }

  // Guest: join by code; resolves to {channel, seed, hostName}
  async joinRoom(code) {
    const { doc, getDoc, updateDoc, onSnapshot, collection, addDoc } = this.fb.fs;
    const roomRef = doc(this.fb.db, 'rooms', code.toUpperCase().trim());
    const snap = await getDoc(roomRef);
    if (!snap.exists()) throw new Error('room-not-found');
    const room = snap.data();
    const pc = this._newPC();
    let unsubCand = null;

    pc.onicecandidate = e => {
      if (e.candidate) addDoc(collection(roomRef, 'guestCand'), e.candidate.toJSON());
    };
    const channel = new Promise((resolve, reject) => {
      pc.ondatachannel = e => {
        e.channel.onopen = () => {
          // connected — stop writing candidates into the room (host deletes it now)
          pc.onicecandidate = null;
          unsubCand?.();
          resolve(e.channel);
        };
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) reject(new Error(pc.connectionState));
      };
    });

    await pc.setRemoteDescription(new RTCSessionDescription(room.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(roomRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      guestUid: this.user.uid, guestName: this.profile.username,
    });
    unsubCand = onSnapshot(collection(roomRef, 'hostCand'), s => {
      s.docChanges().forEach(ch => {
        if (ch.type === 'added') pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(() => {});
      });
    });
    this._unsubs.push(unsubCand);
    return { channel, seed: room.seed, hostName: room.hostName, pc };
  }
}

export const net = new Net();
