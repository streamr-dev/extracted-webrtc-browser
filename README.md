# WebRTC test library for browser

Used to testing the upper limit of peer connections per browser with https://github.com/node-webrtc/node-webrtc

## Install

Make sure that you have nodejs and npm installed

`npm install`

## Running
First run the signaller server with:

```
node signaller.js 127.0.0.1 8080
```

Then start the react app locally with:

```
npm start
```

## Using

Open http://localhost:3000 with two browsers. After the pages are open and the server is running run desired amount of
webRTC connection endpoints on both browsers. The signaller will only connect peers of separate browsers or tabs with
one another. The upper limit of Chrome for WebRTC PeerConnections is 256.