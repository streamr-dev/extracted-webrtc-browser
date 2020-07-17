import React from 'react';
import WebRTC from './webrtc.js'
import randomstring from 'randomstring'
function App() {
    const browserId = randomstring.generate(12)
    return (
        <div>
            <h1>
                webRTC browser test
            </h1>
            <WebRTC signaller={'ws://127.0.0.1:8080'} browserId={ browserId } stunUrls={['stun:stun.l.google.com:19302']}/>
        </div>
    )
}

export default App;
