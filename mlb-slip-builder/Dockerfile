FROM apify/actor-node:24

COPY package*.json ./
RUN npm install --omit=dev

COPY . ./

CMD ["npm", "start"]