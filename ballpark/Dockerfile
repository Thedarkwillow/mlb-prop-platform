FROM apify/actor-node-playwright-chrome:24-1.52.0

COPY package*.json ./
RUN npm install

COPY . ./

CMD npm start