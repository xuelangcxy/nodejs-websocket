/*globals describe, before, it, after*/
'use strict'

require('should')
var ws = require('../index')
var net = require('net')

var TEST_PORT = 8017
var testServer, testClient, testConn

describe('extraHeaders', function () {
	before(function (done) {
		// Create a test server and one client
		testServer = ws.createServer(function (conn) {
			testConn = conn
		}).listen(TEST_PORT, done)
	})

	after(function (done) {
		testConn.close()
		testServer.close(done)
	})

	it('should create a headerString with extra header options', function (done) {
		testServer.once('connection', function (client) {
			client.headers['x-headername'].should.be.equal('header value')
			done()
		})

		ws.connect('ws://localhost:' + TEST_PORT, {
			extraHeaders: {
				'X-HeaderName': 'header value'
			}
		})
	})
})

describe('frames', function () {
	before(function (done) {
		// Create a test server and one client
		testServer = ws.createServer(function (conn) {
			testConn = conn
		}).listen(TEST_PORT, function () {
			testClient = ws.connect('ws://localhost:' + TEST_PORT, done)
		})
	})

	after(function (done) {
		testClient.close()
		testServer.close(done)
	})

	it('should connect to a websocket server', function (done) {
		var client = getClient()

		// Send a string and wait
		client.sendText('test string')
		client.on('text', function (str) {
			str.should.be.equal('TEST STRING')
			done()
		})

		// The server will return upper-cased the text received
		getServer(function (str) {
			this.sendText(str.toUpperCase())
		})
	})

	it('should deliver texts in order', function (done) {
		var strs = ['First', 'Second', 'Third'],
			step = 0

		// Send the list of strings
		var client = getClient()
		strs.forEach(client.sendText, client)

		// Check if the strings arrive in order
		getServer(function (str) {
			str.should.be.equal(strs[step])
			step++
			if (step === strs.length) {
				done()
			}
		})
	})

	it('should send binary data', function (done) {
		var client = getClient(),
			buffer = getBuffer(17)

		// Just send a small binary data
		client.sendBinary(buffer)

		// Test whether the binary received is right
		getServer(null, function (inStream) {
			inStream.on('readable', function () {
				compareBuffers(inStream.read(), buffer)
			})
			inStream.on('end', done)
		})
	})

	it('should stream binary data', function (done) {
		var client = getClient(),
			buffer = getBuffer(1024),
			again = true

		// Send one chunk of binary data
		ws.setBinaryFragmentation(1024)
		var stream = client.beginBinary()
		stream.write(buffer)

		// Wait for the first chunk
		// If it arrives, send another, wait again and done
		getServer(null, function (inStream) {
			inStream.on('readable', function () {
				var read = inStream.read()
				if (!read) {
					// Ignore when read() returns null
					return
				}
				compareBuffers(read, buffer)
				if (again) {
					stream.end(buffer)
					again = false
				}
			})
			inStream.on('end', done)
		})
	})

	it('should not accept concurrent text with binary', function () {
		var client = getClient()

		// Start a binary stream and try to send text data
		var stream = client.beginBinary();
		(function () {
			client.sendText('Hi')
		}).should.throw()
		stream.end()

		// The server do nothing in this case
		getServer()
	})

	it('should expose the headers', function () {
		var client = getClient()
		client.headers.should.have.property('upgrade', 'websocket')
		client.headers.should.have.property('connection', 'Upgrade')
		client.headers.should.have.property('sec-websocket-accept')
	})

	it('should emit pong event on ping', function (done) {
		var client = getClient()

		// Send a ping and wait for the pong
		client.sendPing('Knock knock')
		client.once('pong', function (data) {
			data.should.be.equal('Knock knock')
			done()
		})
	})

	it('should send text and binary data', function (done) {
		var client = getClient(),
			expected = 'text frame',
			textData = 'text data',
			binaryData = new Buffer('binary data')

		// Use send() for text and binary
		client.send(textData)
		client.send(binaryData)

		// Test whether both were received
		getServer(function (str) {
			expected.should.be.equal('text frame')
			expected = 'binary frame'
			str.should.be.equal(textData)
		}, function (inStream) {
			expected.should.be.equal('binary frame')
			expected = ''
			inStream.once('readable', function () {
				compareBuffers(inStream.read(), binaryData)
			})
			inStream.on('end', done)
		})
	})
})

describe('handshake', function () {
	before(function (done) {
		testServer = ws.createServer(function (conn) {
			testConn = conn

			// Send frame right after handshake answer
			conn.sendText('hello')
		}).listen(TEST_PORT, done)
	})

	after(function (done) {
		testServer.close(done)
	})

	it('should work when the handshake response is followed by a WS frame', function (done) {
		// Server ready, make the first connection
		ws.connect('ws://127.0.0.1:' + TEST_PORT, function () {
			this.on('text', function (str) {
				str.should.be.equal('hello')
				this.close()
				done()
			})
		})
	})

	it('should work when there is some missing headers', function (done) {
		var conn = net.connect(TEST_PORT)
		conn.write('GET / HTTP/1.1\r\n' +
			'Host: localhost\r\n' +
			'Sec-websocket-key: key\r\n' +
			'C: 3\r\n' +
			'D: 4\r\n' +
			'E: 5\r\n\r\n')
		conn.once('close', function () {
			done()
		})
	})
})

describe('close', function () {
	before(function (done) {
		// Create a test server and one client
		testServer = ws.createServer(function (conn) {
			testConn = conn
		}).listen(TEST_PORT, function () {
			testClient = ws.connect('ws://localhost:' + TEST_PORT, done)
		})
	})

	var called = false

	it('should stop the server from accepting new connections', function (done) {
		testServer.close(function () {
			called = true
		})

		var newTestClient = ws.connect('ws://localhost:' + TEST_PORT)
		newTestClient.once('error', function (err) {
			err.code.should.be.equal('ECONNREFUSED')
			done()
		})
	})

	it('should emit close after all client connections are closed', function (done) {
		called.should.be.false()
		testClient.close()
		testServer.once('close', function () {
			called.should.be.true()
			done()
		})
	})
})

function getClient() {
	testClient.removeAllListeners()
	return testClient
}

function getBuffer(size) {
	var buffer = new Buffer(size),
		i
	for (i = 0; i < size; i++) {
		buffer[i] = i % 256
	}
	return buffer
}

function compareBuffers(b1, b2) {
	var i
	b1.length.should.be.equal(b2.length)
	for (i = 0; i < b1.length; i++) {
		b1[i].should.be.equal(b2[i])
	}
}

function getServer(ontext, onbinary) {
	testConn.removeAllListeners()
	if (ontext) {
		testConn.on('text', ontext)
	}
	if (onbinary) {
		testConn.on('binary', onbinary)
	}
}