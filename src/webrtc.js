import React from 'react'
const { RTCPeerConnection, RTCSessionDescription } = require('wrtc')

export default class WebRTC extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            nodeCount: '',
            running: false,
            failedConnectionCount: 0,
            failedIceConnectionCount: 0,
            receivedMessageCount: 0,
            dataChannelsClosed: 0,
            dataChannelsOpened: 0,
            buttonText: 'Run'
        }
        this.nodes = {}
        this.signallerWs = null
    }

    setUpSignallerConnection(browserId) {
        this.signallerWs = new WebSocket(this.props.signaller + '/?browserId=' + browserId)
        this.signallerWs.onopen = () => {
            console.info('Connection established to signaller.')

            this.signallerWs.onmessage = async (message) => {
                message = JSON.parse(message.data)
                const {source, destination, nodeId} = message
                if (message.connect) {
                    this.setUpWebRtcConnection(message.connect, true, nodeId)
                } else if (message.offer) {
                    this.setUpWebRtcConnection(source, false, destination)
                    const description = new RTCSessionDescription(message.offer)
                    await this.nodes[destination].connections[source].setRemoteDescription(description)
                    const answer = await this.nodes[destination].connections[source].createAnswer()
                    await this.nodes[destination].connections[source].setLocalDescription(answer)
                    this.sendWsMessage(JSON.stringify({
                        source: destination,
                        destination: source,
                        answer
                    }))
                } else if (message.answer) {
                    if (this.nodes[destination].connections[source]) {
                        const description = new RTCSessionDescription(message.answer)
                        await this.nodes[destination].connections[source].setRemoteDescription(description)
                    } else {
                        console.warn(`Unexpected RTC_ANSWER from ${source} with contents: ${message.answer}`)
                    }
                } else if (message.candidate) {
                    if (this.nodes[destination].connections[source]) {
                        await this.nodes[destination].connections[source].addIceCandidate(message.candidate)
                    } else {
                        console.warn(`Unexpected ICE_CANDIDATE from ${source} with contents: ${message.candidate}`)
                    }
                } else {
                    console.log(message)
                    const error = new Error(`RTC error ${message} while attempting to signal with ${source}`)
                    console.warn(error)
                }
            }
        }
    }

    setUpWebRtcConnection(targetPeerId, isOffering, nodeId) {
        if (this.nodes[nodeId].connections[targetPeerId]) {
            return
        }
        const configuration = {
            iceServers: this.props.stunUrls.map((url) => ({
                urls: url
            }))
        }
        const connection = new RTCPeerConnection(configuration)
        const dataChannel = connection.createDataChannel('streamrDataChannel', {
            id: 0,
            negotiated: true
        })

        if (isOffering) {
            connection.onnegotiationneeded = async () => {
                const offer = await connection.createOffer()
                await connection.setLocalDescription(offer)
                this.sendWsMessage(JSON.stringify({
                    source: nodeId,
                    destination: targetPeerId,
                    offer
                }))
            }
        }

        connection.onicecandidate = (event) => {
            if (event.candidate != null) {
                this.sendWsMessage(JSON.stringify({
                    source: nodeId,
                    destination: targetPeerId,
                    candidate: event.candidate
                }))
            }
        }
        connection.onconnectionstatechange = (event) => {
            if (connection.connectionState === 'failed') {
                this.setState({ failedConnectionCount: this.state.failedConnectionCount += 1 })
            }
        }
        connection.oniceconnectionstatechange = (event) => {
            // console.log('oniceconnectionstatechange', nodeId, targetPeerId, event)
            if (connection.iceConnectionState === 'failed') {
                this.setState({ failedIceConnectionCount: this.state.failedIceConnectionCount += 1 })
            }
        }
        dataChannel.onopen = (event) => {
            console.log('dataChannel.onOpen', nodeId, targetPeerId, event)
            this.setState({ dataChannelsOpened: this.state.dataChannelsOpened += 1 })
            this.nodes[nodeId].readyChannels.add(dataChannel)

        }
        dataChannel.onclose = (event) => {
            this.setState({ dataChannelsClosed: this.state.dataChannelsClosed += 1 })
        }
        dataChannel.onerror = (event) => {
            console.log('dataChannel.onError', nodeId, targetPeerId, event)
            console.warn(event)
        }
        dataChannel.onmessage = (event) => {
            this.setState({ receivedMessageCount: this.state.receivedMessageCount += 1} )
        }
        this.nodes[nodeId].connections[targetPeerId] = connection
        this.nodes[nodeId].dataChannels[targetPeerId] = dataChannel
    }


    addNodeToSignaller(nodeId) {
        if (this.signallerWs) {
            try {
                this.sendWsMessage(JSON.stringify({
                    new: nodeId
                }))
            } catch (e) {
                throw e
            }
        }
    }

    sendWsMessage(msg) {
        // Wait until the state of the socket is not ready and send the message when it is...
        this.waitForSocketConnection(this.signallerWs, () => {
            this.signallerWs.send(msg);
        });
    }

     waitForSocketConnection(socket, callback) {
        setTimeout(() => {
                if (socket.readyState === 1) {
                    if (callback != null){
                        callback();
                    }
                } else {
                    this.waitForSocketConnection(socket, callback);
                }
            }, 5);
    }

    handleChange(event) {
        const value = event.target.value.replace(/\+|-/ig, '')
        this.setState({nodeCount: value})
    }

    async handleConnects(event) {
        event.preventDefault()
        this.setUpSignallerConnection(this.props.browserId)
        for (let i = 0; i < this.state.nodeCount; i++) {
            const nodeId = this.props.browserId + "-" + i
            try {
                this.addNodeToSignaller(nodeId)
                this.nodes[nodeId] = {
                    connections: {},
                    dataChannels: {},
                    readyChannels: new Set(),
                    publishInterval: this.publish(nodeId)
                }
                this.setState({ buttonText: 'Starting.. ' + i })
                await this.sleep(150)
            } catch (e) {
                console.error(e)
            }

        }
        this.setState({ running: true })
    }

    handleDisconnects() {
        Object.keys(this.nodes).forEach(nodeId => {
            const targetPeers = Object.keys(this.nodes[nodeId].connections)
            targetPeers.forEach(node => {
                this.nodes[nodeId].dataChannels[targetPeers].close()
                this.nodes[nodeId].connections[targetPeers].close()
                clearInterval(this.nodes[nodeId].publishInterval)
                delete this.nodes[nodeId]
            })
        })
        this.signallerWs.close()
        this.signallerWs = null
        this.setState({
            running: false,
            failedConnectionCount: 0,
            receivedMessageCount: 0,
            dataChannelsClosed: 0,
            dataChannelsOpened: 0,
            failedIceConnectionCount: 0,
            buttonText: 'Run'
        })
    }

    publish(nodeId) {
        return setInterval(() => {
            Object.values(this.nodes[nodeId].dataChannels).forEach((dataChannel) => {
                if (this.nodes[nodeId].readyChannels.has(dataChannel)) {
                    const str = 'Hello world!'
                    try {
                        dataChannel.send(JSON.stringify({
                            str,
                            time: Date.now()
                        }))
                    } catch (e) {
                        console.error(e)
                    }
                }
            })
        }, 15000)
    }


    sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    render() {
        return (
            <div>
                { this.state.running === false ?
                    <form onSubmit={ this.handleConnects.bind(this) }>
                        <label htmlFor="new-todo">
                            How many peer connections to run?
                        </label>
                        <input type="text" pattern="[0-9]*"
                               onChange={ this.handleChange.bind(this) } value={ this.state.nodeCount }/>
                        <button>
                            { this.state.buttonText }
                        </button>
                    </form>
                    :
                    <div>
                        <button onClick={ this.handleDisconnects.bind(this) }>
                            Disconnect nodes
                        </button>
                        <p>
                            DataChannels opened: { this.state.dataChannelsOpened }
                        </p>
                        <p>
                            DataChannels closed: { this.state.dataChannelsClosed }
                        </p>
                        <p>
                            Total received messages: { this.state.receivedMessageCount }
                        </p>
                        <p>
                            Failed connections: { this.state.failedConnectionCount }
                        </p>
                        <p>
                            Failed ice connections: { this.state.failedIceConnectionCount }
                        </p>
                    </div>
                }
            </div>
        )
    }
}