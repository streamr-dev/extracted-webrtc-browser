const WebSocket = require('ws')
const url = require('url')
const program = require('commander')

program
    .usage('<host> <port>')
    .description('Run example signaller')
    .parse(process.argv)

if (program.args.length < 2) {
    program.outputHelp()
    process.exit(1)
}

const host = program.args[0]
const port = parseInt(program.args[1], 10)

const wss = new WebSocket.Server({
    host,
    port
})

const browserIdToWs = {}
const nodeIdToBrowserId = {}
const neighbors = {}

wss.on('connection', (ws, req) => {
    // Parse id
    const parsed = url.parse(req.url, true)
    const {browserId} = parsed.query
    if (browserId === undefined) {
        ws.send(JSON.stringify({
            code: 'ERROR',
            errorCode: 'ID_NOT_GIVEN_IN_CONNECTION_URL'
        }))
        ws.close(1000, 'parameter "browserId" not supplied in query string')
        return
    }

    // Upon receiving message
    ws.on('message', (message) => {
        let payload
        try {
            payload = JSON.parse(message)
        } catch (e) {
            console.warn('Received malformed json from %s: %s.', id, message)
            ws.send(JSON.stringify({
                code: 'ERROR',
                errorCode: 'MALFORMED_JSON'
            }))
            return
        }
        if (payload.new) {
            const newNodeId = payload.new
            nodeIdToBrowserId[newNodeId] = browserId
            neighbors[newNodeId] = ''

            Object.keys(neighbors).forEach((neighbor) => {
                if (neighbor === newNodeId) {
                    return
                }
                if (neighbor.split('-')[0] === newNodeId.split('-')[0]) {
                    return
                }
                if (neighbors[neighbor] === '' && !Object.values(neighbors).includes(newNodeId)) {
                    neighbors[neighbor] = newNodeId
                    neighbors[newNodeId] = neighbor
                }
            })
            if (neighbors[newNodeId]) {
                ws.send(JSON.stringify({
                    nodeId: newNodeId,
                    connect: neighbors[newNodeId]
                }))
                console.info('Sent connect %s to %s', neighbors[newNodeId], newNodeId)
            }

        } else {
            const {nodeId, destination} = payload
            if (!Object.keys(nodeIdToBrowserId).includes(destination)) {
                console.warn('Received message with unknown destination from %s: %s', nodeId, destination)
                ws.send(JSON.stringify({
                    code: 'ERROR',
                    errorCode: 'UNKNOWN_TARGET_PEER_ID',
                    destination
                }))
                return
            }
            const destinationBrowser = nodeIdToBrowserId[destination]
            browserIdToWs[destinationBrowser].send(message)
            console.log('forwarded %s -> %s: %j', browserId, destination, payload)
        }
    })

    ws.on('close', () => {
        delete browserIdToWs[browserIdToWs]
        Object.keys(nodeIdToBrowserId).forEach((nodeId) => {
            if (nodeIdToBrowserId[nodeId] === browserId) {
                delete nodeIdToBrowserId[nodeId]
            }
        })
        console.info('%s disconnected.', browserIdToWs)
    })

    browserIdToWs[browserId] = ws
    console.info('%s connected.', browserId)
})