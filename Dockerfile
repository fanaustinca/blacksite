FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html manifest.json icon.svg sw.js /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY vendor /usr/share/nginx/html/vendor
EXPOSE 8080
