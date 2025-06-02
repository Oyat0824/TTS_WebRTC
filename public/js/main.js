/* ==========================================================================
   WebRTC 화면 공유 시스템 - 호스트 전용
   ========================================================================== */

var socket;
var peerConnections = new Map(); // 호스트용: 여러 참가자를 위한 연결 맵
var localStream;
var selectedQuality = '720p';
var selectedFramerate = 30;
var selectedBitrate = 1200; // Kbps

// WebRTC 설정 - 초저지연 최적화
var configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { 
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        { 
            urls: 'turn:turn.expressturn.com:3478',
            username: 'ef46S5VQRYGZ42',
            credential: 'OTowMjhQQUE='
        }
    ],
    iceCandidatePoolSize: 3,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all',
    encodedInsertableStreams: false
};

// 참가자 링크 생성 및 복사
function generateViewerLink() {
    const baseUrl = window.location.origin;
    const viewerUrl = `${baseUrl}/viewer`;
    const viewerLinkInput = document.getElementById('viewerLink');
    if (viewerLinkInput) {
        viewerLinkInput.value = viewerUrl;
        viewerLinkInput.placeholder = '위 링크를 복사해서 참가자들에게 공유하세요';
    }
}

function copyViewerLink() {
    const viewerLinkInput = document.getElementById('viewerLink');
    const copyButton = document.getElementById('copyLink');
    const successMessage = document.getElementById('linkSuccess');
    
    if (viewerLinkInput && viewerLinkInput.value) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(viewerLinkInput.value).then(showCopySuccess);
            } else {
                viewerLinkInput.select();
                viewerLinkInput.setSelectionRange(0, 99999);
                document.execCommand('copy');
                showCopySuccess();
            }
        } catch (err) {
            console.error('링크 복사 실패:', err);
            alert('링크 복사에 실패했습니다. 수동으로 복사해주세요.');
        }
    } else {
        alert('먼저 화면 공유를 시작해주세요.');
    }
    
    function showCopySuccess() {
        const originalText = copyButton.textContent;
        copyButton.textContent = '✅ 복사됨!';
        
        if (successMessage) {
            successMessage.classList.remove('hidden');
            setTimeout(() => successMessage.classList.add('hidden'), 3000);
        }
        
        setTimeout(() => copyButton.textContent = originalText, 2000);
    }
}

// 페이지 로드 시 이벤트 설정
document.addEventListener('DOMContentLoaded', () => {
    // 호스트 모드 설정
    document.getElementById('hostControls').classList.remove('hidden');
    generateViewerLink();
    
    // 이벤트 리스너 설정
    const copyButton = document.getElementById('copyLink');
    if (copyButton) copyButton.addEventListener('click', copyViewerLink);
    
    const qualitySelect = document.getElementById('qualitySelect');
    if (qualitySelect) {
        qualitySelect.addEventListener('change', (e) => {
            selectedQuality = e.target.value;
        });
    }
    
    const framerateSelect = document.getElementById('framerateSelect');
    if (framerateSelect) {
        framerateSelect.addEventListener('change', (e) => {
            selectedFramerate = parseInt(e.target.value);
        });
    }
    
    const bitrateSelect = document.getElementById('bitrateSelect');
    if (bitrateSelect) {
        bitrateSelect.addEventListener('change', (e) => {
            selectedBitrate = parseInt(e.target.value);
        });
    }
    
    initializeConnection();
});

// 연결 초기화
function initializeConnection() {
    cleanupConnections();
    socket = io();

    socket.on('connect', () => {
        updateStatus('서버에 연결되었습니다.');
        socket.emit('register-host');
    });

    socket.on('disconnect', () => {
        updateStatus('서버와의 연결이 끊어졌습니다.');
    });

    socket.on('host-exists', () => {
        updateStatus('이미 다른 호스트가 활성화되어 있습니다.');
        alert('이미 다른 호스트가 활성화되어 있습니다. 잠시 후 다시 시도해주세요.');
    });

    setupHostHandlers();
}

// 연결 정리
function cleanupConnections() {
    if (peerConnections.size > 0) {
        peerConnections.forEach(function(pc) {
            pc.close();
        });
        peerConnections.clear();
    }
}

// 호스트 이벤트 핸들러
function setupHostHandlers() {
    document.getElementById('startButton').onclick = startSharing;
    document.getElementById('stopButton').onclick = stopSharing;

    socket.on('answer', async (answer, viewerId) => {
        try {
            if (!viewerId) viewerId = 'viewer_' + Date.now();
            
            const peerConnection = peerConnections.get(viewerId);
            if (!peerConnection) return;
            
            if (peerConnection.signalingState !== 'have-local-offer') {
                if (peerConnection) {
                    peerConnection.close();
                    peerConnections.delete(viewerId);
                }
                return;
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            
        } catch (e) {
            if (viewerId && peerConnections.has(viewerId)) {
                peerConnections.get(viewerId).close();
                peerConnections.delete(viewerId);
            }
        }
    });

    socket.on('ice-candidate', async (candidate, viewerId) => {
        try {
            if (!viewerId) viewerId = 'viewer_' + Date.now();
            
            const peerConnection = peerConnections.get(viewerId);
            if (!peerConnection) return;
            
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (e) {
            // 무시
        }
    });

    socket.on('new-viewer', async (viewerId) => {
        if (peerConnections.has(viewerId)) {
            peerConnections.get(viewerId).close();
            peerConnections.delete(viewerId);
        }
        
        if (localStream) {
            try {
                await createPeerConnectionForViewer(viewerId);
                updateStatus(`새 참가자가 연결되었습니다. (총 ${peerConnections.size}명)`);
            } catch (e) {
                setTimeout(() => {
                    createPeerConnectionForViewer(viewerId);
                }, 1000);
            }
        }
    });

    socket.on('viewer-disconnected', (viewerId) => {
        if (peerConnections.has(viewerId)) {
            peerConnections.get(viewerId).close();
            peerConnections.delete(viewerId);
            updateStatus(`참가자가 나갔습니다. (총 ${peerConnections.size}명)`);
        }
    });
}

// 호스트용 PeerConnection 생성
async function createPeerConnectionForViewer(viewerId) {
    try {
        const peerConnection = new RTCPeerConnection(configuration);
        peerConnections.set(viewerId, peerConnection);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', event.candidate, viewerId);
            }
        };

        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed') {
                peerConnections.delete(viewerId);
            }
        };

        // 로컬 스트림 추가
        if (localStream) {
            localStream.getTracks().forEach((track) => {
                const sender = peerConnection.addTrack(track, localStream);
                
                // 사용자가 선택한 비트레이트 적용 (Kbps -> bps 변환)
                if (track.kind === 'video') {
                    try {
                        const params = sender.getParameters();
                        if (params.encodings && params.encodings.length > 0) {
                            params.encodings[0].maxBitrate = selectedBitrate * 1000;
                            params.encodings[0].scaleResolutionDownBy = 1;
                            // 딜레이 최소화 설정
                            params.encodings[0].maxFramerate = selectedFramerate;
                            params.encodings[0].priority = 'high';
                            params.encodings[0].networkPriority = 'high';
                            params.encodings[0].degradationPreference = 'maintain-framerate';
                            sender.setParameters(params).catch(() => {});
                        }
                    } catch (e) {
                        // 무시
                    }
                }
            });
        }

        // 초저지연 Offer 생성
        const offer = await peerConnection.createOffer({
            offerToReceiveVideo: false,
            offerToReceiveAudio: false,
            voiceActivityDetection: false,
            iceRestart: false
        });

        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer, viewerId);

    } catch (e) {
        if (peerConnections.has(viewerId)) {
            peerConnections.get(viewerId).close();
            peerConnections.delete(viewerId);
        }
    }
}

// 화면 공유 시작
async function startSharing() {
    try {
        updateStatus('화면 공유를 시작합니다...');

        if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('이 브라우저는 화면 공유를 지원하지 않습니다.');
        }

        cleanupConnections();

        // 테이블탑 시뮬레이터 최적화 설정
        const qualityConfigs = {
            '720p': { 
                cursor: 'always', 
                width: { ideal: 1280, max: 1280 }, 
                height: { ideal: 720, max: 720 }, 
                frameRate: { ideal: selectedFramerate, max: selectedFramerate }
            },
            '1080p': { 
                cursor: 'always', 
                width: { ideal: 1920, max: 1920 }, 
                height: { ideal: 1080, max: 1080 }, 
                frameRate: { ideal: selectedFramerate, max: selectedFramerate }
            }
        };
        
        const videoConfig = qualityConfigs[selectedQuality] || qualityConfigs['720p'];

        // 화면 공유 스트림 획득 (시스템 오디오 포함)
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConfig,
            audio: {
                sampleRate: 32000,
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                latency: 0,
                volume: 1.0
            }
        });

        if (!stream) throw new Error('화면 공유 스트림을 가져올 수 없습니다.');

        // 비디오 트랙 딜레이 최소화 설정
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            try {
                await videoTrack.applyConstraints({
                    frameRate: { ideal: selectedFramerate, max: selectedFramerate },
                    width: settings.width,
                    height: settings.height,
                    latency: 0
                });
            } catch (e) {
                // 무시
            }
        }

        stream.getVideoTracks()[0].onended = function() { stopSharing(); };

        localStream = stream;
        
        socket.emit('host-started-sharing');

        document.getElementById('startButton').classList.add('hidden');
        document.getElementById('stopButton').classList.remove('hidden');
        
        // 오디오 상태 상세 체크 및 안내
        var audioTracks = stream.getAudioTracks();
        var audioStatus = '';
        var guidanceMessage = '';
        
        if (audioTracks.length > 0) {
            // 오디오 트랙의 상세 정보 확인
            const audioTrack = audioTracks[0];
            const audioSettings = audioTrack.getSettings();
            
            audioStatus = '시스템 오디오 포함';
            guidanceMessage = '✅ 오디오가 포함되었습니다!';
            
            console.log('오디오 트랙 정보:', audioSettings);
        } else {
            audioStatus = '비디오만';
            guidanceMessage = '⚠️ 오디오가 포함되지 않았습니다. 전체 화면 공유를 선택하거나 특정 창 공유 시 "시스템 오디오 공유" 옵션을 체크해주세요.';
        }
        
        updateStatus('📺 테이블탑 화면 공유 시작! (' + selectedQuality + ', ' + selectedFramerate + 'fps, ' + (selectedBitrate >= 1000 ? (selectedBitrate/1000).toFixed(1) + 'Mbps' : selectedBitrate + 'Kbps') + ', ' + audioStatus + ') 🎬 참가자 링크를 복사해서 공유하세요!');
        
        // 오디오 안내 메시지 표시
        if (guidanceMessage) {
            setTimeout(() => {
                const currentStatus = document.getElementById('hostStatus').textContent;
                updateStatus(currentStatus + '\n' + guidanceMessage);
            }, 2000);
        }

    } catch (e) {
        handleSharingError(e);
    }
}

function handleSharingError(e) {
    const errorMessages = {
        'NotAllowedError': '화면 공유 권한이 거부되었습니다.',
        'NotFoundError': '공유할 화면을 찾을 수 없습니다.',
        'NotReadableError': '화면 공유를 시작할 수 없습니다. 다른 프로그램이 화면을 사용 중일 수 있습니다.'
    };
    
    updateStatus(errorMessages[e.name] || `화면 공유 시작 실패: ${e.message}`);
}

// 화면 공유 중지
function stopSharing() {
    socket.emit('stop-sharing');
    
    if (localStream) {
        localStream.getTracks().forEach(function(track) {
            track.stop();
        });
        localStream = null;
    }
    
    cleanupConnections();
    
    document.getElementById('startButton').classList.remove('hidden');
    document.getElementById('stopButton').classList.add('hidden');
    updateStatus('화면 공유가 중지되었습니다.');
}

// 상태 업데이트
function updateStatus(message) {
    const hostStatus = document.getElementById('hostStatus');
    if (hostStatus) {
        hostStatus.textContent = message;
    }
} 