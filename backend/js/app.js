// 전역 상태
let map;
let marker;
let chartInstance = null;

const API_BASE_URL = 'http://localhost:8000/api/v1/forecast';

// DOM 요소
const uiControls = {
    decisionStatus: document.getElementById('decisionStatus'),
    decisionScore: document.getElementById('decisionScore'),
    decisionReason: document.getElementById('decisionReason'),
    decisionCard: document.getElementById('decisionCard'),
    selectedCoord: document.getElementById('selectedCoord'),
    radarStatus: document.getElementById('radarStatus'),
    pastRainfall: document.getElementById('pastRainfall'),
    futureRainfall: document.getElementById('futureRainfall'),
    modelDetailsList: document.getElementById('modelDetailsList')
};

// 1. 지도 초기화
function initMap() {
    // 대한민국 중부권 기본 중심점
    map = L.map('map').setView([36.5, 127.5], 7);

    // 베이스맵 (CartoDB 다크 매터 - 대시보드 스타일에 적합)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // 실시간 레이더 스냅샷(RainViewer) 오버레이 로드
    addRadarLayer();

    // 마우스 클릭 이벤트 등록
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;
        
        handleMapClick(lat, lon);
    });
}

// 레이더 레이어 연동 (RainViewer 무료 API 활용)
async function addRadarLayer() {
    try {
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!response.ok) throw new Error("RainViewer API 요청 실패");
        const data = await response.json();
        
        // 과거 레이더 프레임 중 가장 최신 프레임 데이터 포착
        const pastFrames = data.radar.past;
        const latestFrame = pastFrames[pastFrames.length - 1]; // 최신 타임스탬프
        
        const radarUrl = `https://tilecache.rainviewer.com/v2/radar/${latestFrame.time}/256/{z}/{x}/{y}/2/1_1.png`;
        const radarLayer = L.tileLayer(radarUrl, {
            opacity: 0.7,
            attribution: 'Radar data by RainViewer',
            zIndex: 1000
        });
        
        radarLayer.addTo(map);
        console.log("레이더 레이어 연동 성공 (Timestamp:", latestFrame.time + ")");
    } catch (e) {
        console.error("레이더 레이어를 불러올 수 없습니다:", e);
    }
}

// 2. 지도 클릭 핸들러 (의사결정 프로세스 시작)
async function handleMapClick(lat, lon) {
    // 마커 이동 또는 생성
    if (marker) {
        marker.setLatLng([lat, lon]);
    } else {
        marker = L.marker([lat, lon]).addTo(map);
    }
    
    // UI 로딩 상태 표시
    uiControls.selectedCoord.innerText = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    uiControls.decisionStatus.innerText = '판단 중...';
    uiControls.decisionReason.innerText = '서버에서 기상 데이터를 융합 분석 중입니다...';
    
    // API 호출 (재시도 로직 포함)
    const data = await fetchWithRetry(`${API_BASE_URL}?lat=${lat}&lon=${lon}`);
    
    if (data) {
        updateDashboardUI(data);
    } else {
        uiControls.decisionStatus.innerText = '오류';
        uiControls.decisionReason.innerText = '백엔드 서버 융합 데이터 조회 실패. 네트워크 상태를 확인하세요.';
    }
}

// 3. 재시도 로직 기반 Fetch (요구사항 8)
async function fetchWithRetry(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('API Error');
            return await response.json();
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} failed. Retrying...`);
            if (i === retries - 1) return null; // 최종 실패
            await new Promise(res => setTimeout(res, backoff * (i + 1)));
        }
    }
}

// 4. 대시보드 UI 업데이트 렌더링
function updateDashboardUI(data) {
    const dec = data.decision;
    const obs = data.observed;
    const radar = data.radar;
    const forecast = data.forecast;

    // --- 의사결정 카드 업데이트 ---
    uiControls.decisionStatus.innerText = dec.status;
    uiControls.decisionScore.innerText = dec.confidence;
    uiControls.decisionReason.innerText = dec.reasons;

    // CSS 배경 클래스 변경
    uiControls.decisionCard.className = 'decision-card'; // 리셋
    if (dec.status === '출동 권고') uiControls.decisionCard.classList.add('status-go');
    else if (dec.status === '대기') uiControls.decisionCard.classList.add('status-wait');
    else uiControls.decisionCard.classList.add('status-stay');

    // --- 정보 그리드 업데이트 ---
    uiControls.radarStatus.innerText = radar.approaching ? '접근 중' : '잔잔함';
    uiControls.radarStatus.style.color = radar.approaching ? 'var(--danger)' : 'var(--text-secondary)';
    
    uiControls.pastRainfall.innerText = obs['24h'];
    
    // 향후 3시간 예측 (ECMWF 기준 합계 - 보수적 판단에 사용한다고 가정)
    const next3A = forecast.model_a.slice(0, 3).reduce((a, b) => a + b, 0).toFixed(1);
    const next3B = forecast.model_b.slice(0, 3).reduce((a, b) => a + b, 0).toFixed(1);
    uiControls.futureRainfall.innerText = `${next3A} (ECMWF) / ${next3B} (GFS)`;

    // --- 모델 상세 데이터 ---
    uiControls.modelDetailsList.innerHTML = `
        <li><strong>레이더 강도 예측:</strong> ${radar.intensity}%</li>
        <li><strong>과거 3시간 강수 (분석):</strong> ${obs['3h']} mm</li>
        <li><strong>판단 채점 지수:</strong> ${dec.score} 포인트</li>
        <li><strong>ECMWF (유럽모델):</strong> 다음 3시간 ${next3A} mm 강수 예측</li>
        <li><strong>GFS (범용/미국모델):</strong> 다음 3시간 ${next3B} mm 강수 예측</li>
    `;

    // --- 차트 렌더링 ---
    renderChart(obs, forecast);
}

// 5. 차트 렌더링 (Chart.js)
function renderChart(observed, forecast) {
    const ctx = document.getElementById('rainfallChart').getContext('2d');
    
    // 기존 차트 파기
    if (chartInstance) {
        chartInstance.destroy();
    }

    // X축 (시간 라벨 조합 - 과거 1시간, 0(현재), 미래 1~12시간)
    const labels = ['-1h', 'Now', '+1h', '+2h', '+3h', '+4h', '+5h', '+6h', '+9h', '+12h'];
    
    // 데이터 가공
    // (막대형 - 실측 강우)
    const pastData = [observed['1h'], 0, null, null, null, null, null, null, null, null];
    
    // (선형 - 모델 A - 보수)
    const modelAData = [null, 0, forecast.model_a[0], forecast.model_a[1], forecast.model_a[2], forecast.model_a[3], forecast.model_a[4], forecast.model_a[5], forecast.model_a[8], forecast.model_a[11]];
    
    // (선형 - 모델 B - 민감)
    const modelBData = [null, 0, forecast.model_b[0], forecast.model_b[1], forecast.model_b[2], forecast.model_b[3], forecast.model_b[4], forecast.model_b[5], forecast.model_b[8], forecast.model_b[11]];

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'bar',
                    label: '관측 강수 (과거)',
                    data: pastData,
                    backgroundColor: 'rgba(54, 162, 235, 0.7)',
                    borderColor: 'rgb(54, 162, 235)',
                    borderWidth: 1
                },
                {
                    type: 'line',
                    label: '예측 강수 (ECMWF)',
                    data: modelAData,
                    borderColor: '#2ea043', // Green
                    backgroundColor: '#2ea043',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2
                },
                {
                    type: 'line',
                    label: '예측 강수 (GFS)',
                    data: modelBData,
                    borderColor: '#f85149', // Red
                    backgroundColor: '#f85149',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2,
                    borderDash: [5, 5] // 점선 표시
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            color: '#c9d1d9',
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: '강수량 (mm)',
                        color: '#8b949e'
                    },
                    grid: { color: '#30363d' }
                },
                x: {
                    title: {
                        display: true,
                        text: '시간',
                        color: '#8b949e'
                    },
                    grid: { color: '#30363d' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#c9d1d9' }
                }
            }
        }
    });
}

// 초기화
window.onload = initMap;
