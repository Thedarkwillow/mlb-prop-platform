FROM apify/actor-node-playwright-chrome:24

WORKDIR /usr/src/app

USER root

COPY package*.json ./
RUN npm install

COPY . ./

RUN chown -R myuser:myuser /usr/src/app

USER myuser

CMD ["npm", "start"]