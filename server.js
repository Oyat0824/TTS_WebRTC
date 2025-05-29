const express = require('express');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();

// SSL 인증서 설정
let server;
try {
    const options = {
        key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
    };
    server = https.createServer(options, app);
    console.log('HTTPS 서버가 설정되었습니다.');
} catch (error) {
    console.log('SSL 인증서를 찾을 수 없어 HTTP 서버로 실행됩니다.');
    server = http.createServer(app);
}

const io = new Server(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 라우트 설정
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/viewer', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// 연결 상태 관리
class ConnectionManager {
    constructor() {
        this.currentHost = null;
        this.hostStream = null;
        this.viewers = new Map();
        this.hostState = null;
        this.isHostSharing = false;
    }

    // 호스트 등록
    registerHost(socket) {
        if (this.currentHost) {
            socket.emit('host-exists');
            return false;
        }

        this.currentHost = socket.id;
        this.hostState = {
            socket: socket,
            isConnected: true,
            lastStream: null
        };
        
        return true;
    }

    // 참가자 등록
    registerViewer(socket) {
        if (this.viewers.has(socket.id)) {
            this.viewers.delete(socket.id);
        }

        const viewerState = {
            socket: socket,
            isConnected: true,
            hasAnswered: false,
            lastAnswer: null
        };
        
        this.viewers.set(socket.id, viewerState);
    }

    // 새로운 스트림 설정
    setHostStream(socket, stream, viewerId) {
        if (socket.id !== this.currentHost) {
            return;
        }

        this.hostStream = stream;
        this.hostState.lastStream = stream;

        if (viewerId) {
            const viewerState = this.viewers.get(viewerId);
            if (viewerState && viewerState.isConnected) {
                viewerState.hasAnswered = false;
                viewerState.lastAnswer = null;
                this.sendStreamToViewer(viewerState.socket);
            }
        } else {
            this.broadcastStream();
        }
    }

    // 스트림 전송
    sendStreamToViewer(viewerSocket) {
        if (!this.hostStream || !this.currentHost) {
            return;
        }
        viewerSocket.emit('offer', this.hostStream, viewerSocket.id);
    }

    // 모든 참가자에게 스트림 전송
    broadcastStream() {
        if (!this.hostStream) return;

        this.viewers.forEach((viewerState, viewerId) => {
            if (viewerState.isConnected) {
                viewerState.hasAnswered = false;
                viewerState.lastAnswer = null;
                this.sendStreamToViewer(viewerState.socket);
            }
        });
    }

    // 참가자 응답 처리
    handleViewerAnswer(viewerSocket, answer, viewerId) {
        const viewerState = this.viewers.get(viewerSocket.id);
        if (!viewerState || !viewerState.isConnected || viewerState.hasAnswered) {
            return;
        }

        if (this.currentHost && this.hostState.isConnected) {
            viewerState.hasAnswered = true;
            viewerState.lastAnswer = answer;
            this.hostState.socket.emit('answer', answer, viewerSocket.id);
        }
    }

    // ICE candidate 처리
    handleIceCandidate(socket, candidate, targetId) {
        if (socket.id === this.currentHost) {
            // 호스트에서 온 ICE candidate를 참가자들에게 전송
            if (targetId) {
                const viewerState = this.viewers.get(targetId);
                if (viewerState && viewerState.isConnected) {
                    viewerState.socket.emit('ice-candidate', candidate, socket.id);
                }
            } else {
                this.viewers.forEach((viewerState) => {
                    if (viewerState.isConnected) {
                        viewerState.socket.emit('ice-candidate', candidate, socket.id);
                    }
                });
            }
        } else if (this.currentHost && this.hostState.isConnected) {
            // 참가자에서 온 ICE candidate를 호스트에게 전송
            this.hostState.socket.emit('ice-candidate', candidate, socket.id);
        }
    }

    // 연결 해제 처리
    handleDisconnect(socket) {
        if (socket.id === this.currentHost) {
            this.currentHost = null;
            this.hostStream = null;
            this.hostState = null;
            this.isHostSharing = false;
            
            this.viewers.forEach((viewerState, viewerId) => {
                if (viewerState.isConnected) {
                    viewerState.socket.emit('host-disconnected');
                    viewerState.hasAnswered = false;
                    viewerState.lastAnswer = null;
                }
            });
            
        } else {
            const viewerState = this.viewers.get(socket.id);
            if (viewerState) {
                this.viewers.delete(socket.id);
                
                if (this.currentHost && this.hostState && this.hostState.isConnected) {
                    this.hostState.socket.emit('viewer-disconnected', socket.id);
                }
                
            }
        }
    }

    // 화면 공유 중단 처리
    handleHostStop() {
        this.hostStream = null;
        this.isHostSharing = false;
        if (this.hostState) {
            this.hostState.lastStream = null;
        }
        
        this.viewers.forEach((viewerState, viewerId) => {
            if (viewerState.isConnected) {
                viewerState.hasAnswered = false;
                viewerState.lastAnswer = null;
                viewerState.socket.emit('host-stopped-sharing');
            }
        });
    }

    // 화면 공유 시작 처리
    handleHostStart() {
        this.isHostSharing = true;
        
        this.viewers.forEach((viewerState, viewerId) => {
            if (viewerState.isConnected) {
                viewerState.hasAnswered = false;
                viewerState.lastAnswer = null;
                this.hostState.socket.emit('new-viewer', viewerId);
            }
        });
    }

    // 스트림 요청 처리
    handleStreamRequest(socket) {
        const viewerState = this.viewers.get(socket.id);
        if (!viewerState) {
            return;
        }

        if (this.currentHost && this.hostState && this.hostState.isConnected) {
            if (this.isHostSharing) {
                // 시청자 상태 완전 초기화 (재연결 대응)
                viewerState.hasAnswered = false;
                viewerState.lastAnswer = null;
                viewerState.isConnected = true;
                
                // 호스트에게 새 시청자 알림 - 즉시 Offer를 생성하도록
                this.hostState.socket.emit('new-viewer', socket.id);
                
                // 재연결을 위한 다중 재시도 시스템
                let retryCount = 0;
                const maxRetries = 3;
                const retryInterval = setInterval(() => {
                    retryCount++;
                    const currentViewerState = this.viewers.get(socket.id);
                    
                    if (!currentViewerState || currentViewerState.hasAnswered) {
                        clearInterval(retryInterval);
                        return;
                    }
                    
                    if (retryCount <= maxRetries && this.isHostSharing) {
                        this.hostState.socket.emit('new-viewer', socket.id);
                    } else {
                        clearInterval(retryInterval);
                        // 마지막 수단: 시청자에게 재요청 권장
                        socket.emit('suggest-refresh');
                    }
                }, 3000);
                
            } else {
                viewerState.isConnected = true;
                // 방송이 시작되면 자동으로 연결되도록 대기
            }
        } else {
            socket.emit('host-disconnected');
        }
    }
}

const connectionManager = new ConnectionManager();

// WebSocket 연결 처리
io.on('connection', (socket) => {

    // 호스트 등록
    socket.on('register-host', () => {
        if (connectionManager.registerHost(socket)) {
            socket.join('host-room');
        }
    });

    // 참가자 등록
    socket.on('register-viewer', () => {
        connectionManager.registerViewer(socket);
        socket.join('viewer-room');
    });

    // 스트림 요청
    socket.on('request-stream', () => {
        connectionManager.handleStreamRequest(socket);
    });

    // 화면 공유 시작
    socket.on('host-started-sharing', () => {
        if (socket.id === connectionManager.currentHost) {
            connectionManager.handleHostStart();
        }
    });

    // 화면 공유 중단
    socket.on('stop-sharing', () => {
        if (socket.id === connectionManager.currentHost) {
            connectionManager.handleHostStop();
        }
    });

    // WebRTC 시그널링
    socket.on('offer', (offer, viewerId) => {
        connectionManager.setHostStream(socket, offer, viewerId);
    });

    socket.on('answer', (answer, viewerId) => {
        connectionManager.handleViewerAnswer(socket, answer, viewerId);
    });

    socket.on('ice-candidate', (candidate, targetId) => {
        connectionManager.handleIceCandidate(socket, candidate, targetId);
    });

    // 성능 최적화 요청 처리
    socket.on('request-quality-reduction', () => {
        if (connectionManager.currentHost && connectionManager.hostState && connectionManager.hostState.isConnected) {
            connectionManager.hostState.socket.emit('viewer-requests-quality-reduction', socket.id);
        }
    });

    // 연결 해제
    socket.on('disconnect', () => {
        connectionManager.handleDisconnect(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    const protocol = server instanceof https.Server ? 'https' : 'http';
    console.log('서버가 시작되었습니다!');
    console.log('다음 주소로 접속해보세요:');
    console.log(`- 로컬 접속: ${protocol}://localhost:${PORT}`);
    console.log(`- 네트워크 접속: ${protocol}://${getLocalIP()}:${PORT}`);
});

// 로컬 IP 주소 가져오기
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
} 