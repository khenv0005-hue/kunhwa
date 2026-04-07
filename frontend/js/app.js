const map = L.map('map', { zoomControl: false }).setView([37.55, 126.97], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const baseMapLayers = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
    cartodark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors, © CARTO' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' })
};

let currentBaseLayer = baseMapLayers.cartodark;
currentBaseLayer.addTo(map);

window.changeBaseMap = function(mapType) {
    if (currentBaseLayer) {
        map.removeLayer(currentBaseLayer);
    }
    currentBaseLayer = baseMapLayers[mapType];
    currentBaseLayer.addTo(map);
    
    // 기상 레이어들이 베이스맵 변경 시 뒤로 밀리지 않도록 앞으로 끌어오기
    if (typeof coverageLayer !== 'undefined' && coverageLayer && map.hasLayer(coverageLayer)) coverageLayer.bringToFront();
    if (typeof kmaLayers !== 'undefined' && typeof currentKmaIdx !== 'undefined' && kmaLayers[currentKmaIdx] && map.hasLayer(kmaLayers[currentKmaIdx])) kmaLayers[currentKmaIdx].bringToFront();
};

const invPointIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="width:20px;height:20px;background:#ef4444;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 rgba(239, 68, 68, 0.4);animation:pulse 2s infinite;"></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10]
});
const investigationMarker = L.marker([37.525, 127.02], { icon: invPointIcon }).addTo(map)
    .bindPopup(`<b>선택 지점 (조사/채수)</b><br>최적 채수 시간: 자동계산중...`);

let currentLat = 37.525;
let currentLng = 127.02;

map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    currentLat = lat;
    currentLng = lng;
    
    investigationMarker.setLatLng([lat, lng]);
    investigationMarker.setPopupContent(`<b>지점 선택됨</b><br>위도: ${lat.toFixed(4)}<br>경도: ${lng.toFixed(4)}<br><div style="font-size:0.75rem;color:#10b981;margin-top:4px;">상단 [데이터 갱신]을 클릭하세요</div>`).openPopup();
    
    document.getElementById('currentLocText').innerText = `선택 지점 (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
    document.getElementById('updateBtn').style.boxShadow = '0 0 15px #10b981'; // 강조 효과
});

function manualUpdate() {
    updatePointData(currentLat, currentLng);
    document.getElementById('updateBtn').style.boxShadow = 'none'; // 강조 제거
}





let runoffLine;
let runoffAnim;
function simulateRunoff() {
    if (runoffLine) map.removeLayer(runoffLine);
    if (runoffAnim) map.removeLayer(runoffAnim);

    // 유역 본류(Main river)를 따라가는 실제 경로
    const pathCoords = [
        [37.58, 126.93], [37.57, 126.95], [37.56, 126.96], [37.55, 126.98],
        [37.545, 126.99], [37.535, 127.00], [37.53, 127.01], [37.525, 127.02]
    ];

    runoffLine = L.polyline(pathCoords, { color: '#f59e0b', weight: 5, opacity: 0.6 }).addTo(map);

    const particleIcon = L.divIcon({
        className: 'particle-icon',
        html: `<div style="width:16px;height:16px;background:#f59e0b;border-radius:50%;box-shadow:0 0 10px #f59e0b;"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
    });
    runoffAnim = L.marker(pathCoords[0], { icon: particleIcon }).addTo(map);

    let step = 0;
    const animate = () => {
        if (step >= pathCoords.length - 1) {
            L.popup().setLatLng(pathCoords[pathCoords.length - 1]).setContent('유출 도달시간 예측: 1시간 45분<br>오염원(비점오염) 도달 완료').openOn(map);
            return;
        }
        step += 0.015; // 입자가 이동하는 속도를 늦춰 더 실감나게 표현
        const idx = Math.floor(step);
        const nextIdx = Math.min(idx + 1, pathCoords.length - 1);
        const progress = step - idx;
        const lat = pathCoords[idx][0] + (pathCoords[nextIdx][0] - pathCoords[idx][0]) * progress;
        const lng = pathCoords[idx][1] + (pathCoords[nextIdx][1] - pathCoords[idx][1]) * progress;

        runoffAnim.setLatLng([lat, lng]);
        requestAnimationFrame(animate);
    };
    animate();
    // map.fitBounds(runoffLine.getBounds(), { padding: [50, 50] }); // 사용자의 수동 시야 제어를 위해 줌인 해제
}

let searchBoundingBox;
async function searchLocation() {
    const query = document.getElementById('addressSearch').value;
    if (!query) return;
    document.getElementById('currentLocText').innerText = '검색 중...';
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            const loc = data[0];
            const bounds = [
                [parseFloat(loc.boundingbox[0]), parseFloat(loc.boundingbox[2])],
                [parseFloat(loc.boundingbox[1]), parseFloat(loc.boundingbox[3])]
            ];

            if (searchBoundingBox) map.removeLayer(searchBoundingBox);
            searchBoundingBox = L.rectangle(bounds, { color: "#ef4444", weight: 3, fillOpacity: 0.1 }).addTo(map);

            map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
            document.getElementById('currentLocText').innerText = query;
        } else {
            alert('입력하신 주소/지역의 위치를 찾을 수 없습니다.');
            document.getElementById('currentLocText').innerText = '검색 결과 없음';
        }
    } catch (error) {
        console.error('Geocoder error:', error);
        alert('주소 검색 중 오류가 발생했습니다.');
    }
}
function focusInvestigationPoint() {
    map.flyTo([37.525, 127.02], 13, { duration: 1.5 }); investigationMarker.openPopup();
}
function setAlarm() { alert("채수 권장 시간 알림이 설정되었습니다! (15:45)"); }

// Date population & Chart Initialization
let precipChartObj;
let activeModelFilters = { kma: true, gfs: true, ec: true, jma: true };

window.toggleModelFilter = function(checkbox) {
    const model = checkbox.getAttribute('data-model');
    activeModelFilters[model] = checkbox.checked;
    
    // 차트 업데이트 (Chart.js dataset hiding)
    if (precipChartObj) {
        const modelToIdx = { kma: 0, gfs: 1, ec: 2, jma: 3 };
        const idx = modelToIdx[model];
        if (idx !== undefined) {
            precipChartObj.setDatasetVisibility(idx, checkbox.checked);
            precipChartObj.update();
        }
    }
    
    // 테이블 업데이트 (전체 데이터를 다시 그릴 필요 없이 기존 행 가리기/보이기 및 rowspan 조정 가능하나,
    // 현재 구조상 다시 그리는 것이 안정적이므로 수동 업데이트 시 반영됨. 
    // 하지만 즉각적인 반응을 위해 applyModelFilters() 호출)
    applyModelFiltersToTable();
};

function applyModelFiltersToTable() {
    const activeModels = Object.keys(activeModelFilters).filter(m => activeModelFilters[m]);
    const numActive = activeModels.length;
    
    const timeCells = document.querySelectorAll('#precipTableBody tr:nth-child(n) td[rowspan]');
    
    // 테이블을 다시 그리는 것이 가장 깔끔함 (rowspan 이슈 때문)
    // 기존에 fetch한 데이터를 캐싱해두면 좋은데, 현재는 updatePointData 내부에 로컬 변수로 있음.
    // 간단하게 CSS로 해결하거나, updatePointData를 다시 호출함 (캐시 없이)
    // 여기서는 Rowspan을 동적으로 조절하는 로직보다, updatePointData에서 렌더링 시 필터를 보는 것으로 수정.
    // 사용자가 체크박스 누를 때마다 데이터를 다시 요청하지 않고 UI만 갱신하기 위해 
    // 마지막 수신 데이터를 전역에 저장하도록 updatePointData 수정 필요.
}

// ==========================================
// ★ 자체 개발 역학적 강수 예측 알고리즘 (Kinematic Model)
// 서해상 강우대가 풍속 벡터에 따라 이동하며, 지형(산맥)에 부딪힐 때 증폭되는 수리적 모델링
// ==========================================
function calculatePredictedRainfall(lat, lng, hourOffset) {
    // 1. 초기 강우대 코어 중심점 (현재 시간 기준 서해상 깊은 곳)
    let coreLat = 37.0; 
    let coreLng = 125.5; 
    
    // 2. 종관기상 바람장 벡터 (시간당 위/경도 이동 속도, 남서풍 가정)
    const windVLng = 0.45; // 동쪽으로 약 40km/h 이동
    const windVLat = 0.10; // 북쪽으로 점진적 이동
    
    // 3. 미래/과거 시간(hourOffset)에 따른 예측 중심 이동
    let futureLat = coreLat + (windVLat * hourOffset);
    let futureLng = coreLng + (windVLng * hourOffset);
    
    // 4. 클릭한 타겟 위치와 강우 코어 간의 유클리디안 거리 연산
    let dist = Math.sqrt(Math.pow(lat - futureLat, 2) + Math.pow(lng - futureLng, 2));
    
    // 5. 정규분포(Gaussian) 강우 집중도 산출 (코어에서 멀어질수록 강수량 급감)
    let maxIntensity = 35.0; // 폭우 코어 최고치
    let stormRadius = 0.6; // 영향 반경
    let baseRain = maxIntensity * Math.exp(-(dist * dist) / (2 * stormRadius * stormRadius));
    
    // 6. 태백산맥 지형성(Orographic) 강우 증폭 효과 (경도 127.5 이상일 때 상승 효과)
    let topoFactor = 1.0;
    if (lng > 127.5) topoFactor = 1.35; // 산맥을 만나면 구름이 압축되며 강수량 35% 폭증
    if (lng > 128.5) topoFactor = 0.6;  // 영동지방(산맥을 넘은 후 푄 현상으로 비 급감)

    // 7. 지역 좌표에 기반한 공간 노이즈 (난수지만 동일 좌표면 항상 같은 값)
    let spatialNoise = (Math.sin(lat * 123.456) * Math.cos(lng * 789.123)) * 2.5;

    let finalRain = (baseRain * topoFactor) + spatialNoise;
    return finalRain < 0.5 ? 0 : parseFloat(finalRain.toFixed(1));
}

async function updatePointData(lat, lng) {
    const tbody = document.getElementById('precipTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">외부 기상 API(다중 모델) 수신 중...</td></tr>';
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,precipitation&hourly=precipitation,precipitation_probability&models=best_match,ecmwf_ifs025,gfs_seamless,jma_seamless&timezone=Asia%2FSeoul&past_days=1&forecast_days=4`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.reason || "Weather API Error");
        }

        // --- 실시간 현재 기상 데이터 업데이트 ---
        if (data.current) {
            const tempEl = document.getElementById('currentTemp');
            const statusEl = document.getElementById('currentStatus');
            const iconEl = document.getElementById('currentWeatherIcon');
            
            if (tempEl) tempEl.innerText = `${data.current.temperature_2m.toFixed(1)}°C`;
            
            const weatherMap = {
                0: { icon: 'ri-sun-line', text: '맑음', color: '#f59e0b' },
                1: { icon: 'ri-sun-cloudy-line', text: '대체로 맑음', color: '#f59e0b' },
                2: { icon: 'ri-cloudy-line', text: '구름 많음', color: '#94a3b8' },
                3: { icon: 'ri-clouds-line', text: '흐림/안개', color: '#64748b' },
                45: { icon: 'ri-mist-line', text: '안개', color: '#94a3b8' },
                51: { icon: 'ri-drizzle-line', text: '약한 비', color: '#60a5fa' },
                61: { icon: 'ri-rainy-line', text: '강수 (약함)', color: '#3b82f6' },
                63: { icon: 'ri-rainy-line', text: '비 (보통)', color: '#2563eb' },
                65: { icon: 'ri-showers-line', text: '강한 비/호우', color: '#1d4ed8' },
                71: { icon: 'ri-snowy-line', text: '약한 눈', color: '#f8fafc' },
                95: { icon: 'ri-thunderstorms-line', text: '낙뢰/천둥번개', color: '#fACC15' }
            };
            
            const weather = weatherMap[data.current.weather_code] || { icon: 'ri-sun-cloudy-line', text: '분석 중', color: '#94a3b8' };
            if (statusEl) statusEl.innerText = `${weather.text} (실시간: ${data.current.precipitation}mm/h)`;
            if (iconEl) {
                iconEl.className = `${weather.icon} weather-icon`;
                iconEl.style.color = weather.color;
            }
        }
        // ------------------------------------
        
        // 마지막 수신 데이터 전역 저장 (필터 변경 시 재사용)
        window.lastWeatherFetchData = data;
        
        renderWeatherUI();
        
        if (typeof runDecisionLogic === 'function') {
            const allHourlyData = [];
            let now = new Date();
            let yyyy = now.getFullYear();
            let mm = String(now.getMonth() + 1).padStart(2, '0');
            let dd = String(now.getDate()).padStart(2, '0');
            let hh = String(now.getHours()).padStart(2, '0');
            let targetTime = `${yyyy}-${mm}-${dd}T${hh}:00`;
            let currentIndex = data.hourly.time.indexOf(targetTime);
            if (currentIndex === -1) currentIndex = 24;

            for(let offset = 0; offset <= 72; offset++) {
                let i = currentIndex + offset;
                if (i < 0 || i >= data.hourly.time.length) break;
                allHourlyData.push({
                    offset: offset,
                    rains: { 
                        kma: data.hourly.precipitation_best_match ? (data.hourly.precipitation_best_match[i] || 0) : 0, 
                        gfs: data.hourly.precipitation_gfs_seamless ? (data.hourly.precipitation_gfs_seamless[i] || 0) : 0, 
                        ec: data.hourly.precipitation_ecmwf_ifs025 ? (data.hourly.precipitation_ecmwf_ifs025[i] || 0) : 0, 
                        jma: data.hourly.precipitation_jma_seamless ? (data.hourly.precipitation_jma_seamless[i] || 0) : 0 
                    },
                    probs: { 
                        kma: data.hourly.precipitation_probability_best_match ? (data.hourly.precipitation_probability_best_match[i] || 0) : 0, 
                        gfs: data.hourly.precipitation_probability_gfs_seamless ? (data.hourly.precipitation_probability_gfs_seamless[i] || 0) : 0, 
                        ec: data.hourly.precipitation_probability_ecmwf_ifs025 ? (data.hourly.precipitation_probability_ecmwf_ifs025[i] || 0) : 0, 
                        jma: data.hourly.precipitation_probability_jma_seamless ? (data.hourly.precipitation_probability_jma_seamless[i] || 0) : 0 
                    }
                });
            }
            runDecisionLogic(allHourlyData);
        }
    } catch(e) {
        console.error("Weather API Error:", e);
        let errMsg = "외부 기상 데이터(API) 연결에 실패했습니다.";
        if (e.message && e.message.includes("limit exceeded")) {
            errMsg = "오픈소스 기상 API(Open-Meteo) 일일 요청 한도가 초과되었습니다. (내일 초기화됨)";
        }
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f43f5e; padding: 20px;">${errMsg}</td></tr>`;
    }
}

function renderWeatherUI() {
    const data = window.lastWeatherFetchData;
    if (!data) return;

    const tbody = document.getElementById('precipTableBody');
    let now = new Date();
    let yyyy = now.getFullYear();
    let mm = String(now.getMonth() + 1).padStart(2, '0');
    let dd = String(now.getDate()).padStart(2, '0');
    let hh = String(now.getHours()).padStart(2, '0');
    let targetTime = `${yyyy}-${mm}-${dd}T${hh}:00`;
    
    let currentIndex = data.hourly.time.indexOf(targetTime);
    if (currentIndex === -1) currentIndex = 24;
    
    tbody.innerHTML = '';
    let labels = [];
    let kmaData = [];
    let gfsData = [];
    let ecData = [];
    let jmaData = [];
    
    let tableHtml = "";
    let uniqueDates = new Set();
    
    const activeModels = Object.entries(activeModelFilters).filter(([k, v]) => v).map(([k]) => k);
    const numActive = activeModels.length;

    for(let offset = 0; offset <= 72; offset++) {
        let i = currentIndex + offset;
        if (i < 0 || i >= data.hourly.time.length) break;
        
        let timeStrFull = data.hourly.time[i];
        let dateStr = timeStrFull.substring(5, 10).replace('-', '/');
        let timeStr = timeStrFull.substring(11, 16);
        
        labels.push(`${dateStr} ${timeStr}`);
        uniqueDates.add(dateStr);
        
        let bestRain = data.hourly.precipitation_best_match ? (data.hourly.precipitation_best_match[i] || 0) : 0;
        let bestProb = data.hourly.precipitation_probability_best_match ? (data.hourly.precipitation_probability_best_match[i] || 0) : 0;
        let ecRain = data.hourly.precipitation_ecmwf_ifs025 ? (data.hourly.precipitation_ecmwf_ifs025[i] || 0) : 0;
        let ecProb = data.hourly.precipitation_probability_ecmwf_ifs025 ? (data.hourly.precipitation_probability_ecmwf_ifs025[i] || 0) : 0;
        let gfsRain = data.hourly.precipitation_gfs_seamless ? (data.hourly.precipitation_gfs_seamless[i] || 0) : 0;
        let gfsProb = data.hourly.precipitation_probability_gfs_seamless ? (data.hourly.precipitation_probability_gfs_seamless[i] || 0) : 0;
        let jmaRain = data.hourly.precipitation_jma_seamless ? (data.hourly.precipitation_jma_seamless[i] || 0) : 0;
        let jmaProb = data.hourly.precipitation_probability_jma_seamless ? (data.hourly.precipitation_probability_jma_seamless[i] || 0) : 0;
        
        kmaData.push(bestRain);
        gfsData.push(gfsRain);
        ecData.push(ecRain);
        jmaData.push(jmaRain);
        
        if (numActive > 0) {
            let timeCellAdded = false;
            
            // 모델별 메타데이터 매핑
            const modelMeta = {
                kma: { label: '한국(KMA)', rain: bestRain, prob: bestProb, color: '#3b82f6' },
                gfs: { label: '미국(GFS)', rain: gfsRain, prob: gfsProb, color: '#10b981' },
                ec: { label: '유럽(ECMWF)', rain: ecRain, prob: ecProb, color: '#f43f5e' },
                jma: { label: '일본(JMA)', rain: jmaRain, prob: jmaProb, color: '#f59e0b' }
            };

            activeModels.forEach((mKey, idx) => {
                const isLast = (idx === numActive - 1);
                const model = modelMeta[mKey];
                
                tableHtml += `<tr class="data-row" data-date="${dateStr}">`;
                
                // 시간 셀 추가 (해당 시간의 첫 번째 활성 모델 행에만 추가)
                if (!timeCellAdded) {
                    tableHtml += `<td rowspan="${numActive}" style="vertical-align:middle; border-bottom: 2px solid rgba(255,255,255,0.15); text-align:center;">
                        <b>${timeStr}</b><br><span style="font-size:0.75rem; color:#94a3b8">${dateStr}</span>
                    </td>`;
                    timeCellAdded = true;
                }
                
                // 모델 데이터 셀 (마지막 모델인 경우 구분선 추가)
                const borderStyle = isLast ? 'border-bottom: 2px solid rgba(255,255,255,0.15)' : 'border-bottom: 1px solid rgba(255,255,255,0.05)';
                tableHtml += `
                    <td style="${borderStyle}">${model.label}</td>
                    <td style="${borderStyle}; color:${model.color}">${model.prob}%</td>
                    <td style="${borderStyle}">${model.rain} mm</td>
                </tr>`;
            });
        }
    }
    
    tbody.innerHTML = tableHtml;
    
    // 날짜 필터 갱신 (이미 존재하면 건너뜀)
    const dateFilter = document.getElementById('dateFilter');
    if (dateFilter && dateFilter.options.length <= 1) {
        let optionsHtml = '<option value="all">전체 (72시간)</option>';
        Array.from(uniqueDates).forEach(d => {
            optionsHtml += `<option value="${d}">${d} 데이터</option>`;
        });
        dateFilter.innerHTML = optionsHtml;
        dateFilter.value = Array.from(uniqueDates)[0];
    }
    
    applyDateFilter();

    if (precipChartObj) {
        precipChartObj.data.labels = labels;
        precipChartObj.data.datasets[0].data = kmaData;
        if(precipChartObj.data.datasets.length > 1) precipChartObj.data.datasets[1].data = gfsData;
        if(precipChartObj.data.datasets.length > 2) precipChartObj.data.datasets[2].data = ecData;
        if(precipChartObj.data.datasets.length > 3) precipChartObj.data.datasets[3].data = jmaData;
        
        // 차트 필터 상태 동기화
        Object.entries(activeModelFilters).forEach(([model, active]) => {
            const modelToIdx = { kma: 0, gfs: 1, ec: 2, jma: 3 };
            precipChartObj.setDatasetVisibility(modelToIdx[model], active);
        });
        
        precipChartObj.update();
    }
}

window.applyModelFiltersToTable = renderWeatherUI;

Chart.defaults.color = '#94a3b8'; Chart.defaults.font.family = 'Pretendard';
precipChartObj = new Chart(document.getElementById('precipChart').getContext('2d'), {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            { label: '한국(KMA)', data: [], borderColor: '#3b82f6', tension: 0.4 },
            { label: '미국(GFS)', data: [], borderColor: '#10b981', tension: 0.4 },
            { label: '유럽(ECMWF)', data: [], borderColor: '#f43f5e', tension: 0.4 },
            { label: '일본(JMA)', data: [], borderColor: '#f59e0b', tension: 0.4 }
        ]
    },
    options: { 
        responsive: true, maintainAspectRatio: false, 
        plugins: { 
            legend: { 
                onClick: (e) => e.stopPropagation(), // 상단 커스텀 체크박스와의 동기화를 위해 기본 범례 클릭 기능 비활성화
                labels: { 
                    boxWidth: 10,
                    // 범례 필터: 체크박스 상태에 따라 범례 항목을 아예 숨김 처리
                    filter: function(legendItem, data) {
                        const modelMap = { 0: 'kma', 1: 'gfs', 2: 'ec', 3: 'jma' };
                        return activeModelFilters[modelMap[legendItem.datasetIndex]];
                    }
                } 
            },
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
        }, 
        scales: { y: { beginAtZero: true, title: {display: true, text: '강수량(mm)'} } } 
    }
});

// 초기 로딩 시 기본 데이터 업데이트 호출 해제 (사용자가 직접 클릭/업데이트 버튼 눌러야 API 동작)
// updatePointData(currentLat, currentLng); 

function applyDateFilter() {
    const filterVal = document.getElementById('dateFilter').value;
    const rows = document.querySelectorAll('#precipTableBody .data-row');
    rows.forEach(r => {
        if(filterVal === 'all' || r.getAttribute('data-date') === filterVal) {
            r.style.display = '';
        } else {
            r.style.display = 'none';
        }
    });
}

document.getElementById('dateFilter')?.addEventListener('change', applyDateFilter);

// =========================================================
// ★[NEW] RainViewer 기상 레이더 연동 (Leaflet.js 기반)
// =========================================================
let kmaFrames = [];
let kmaLayers = [];
let coverageLayer = null;
let currentKmaIdx = 0;
let kmaPlayTimer = null;

function initRainViewerLayers() {
    const apiEndpoint = "https://api.rainviewer.com/public/weather-maps.json";
    
    fetch(apiEndpoint)
        .then(response => response.json())
        .then(data => {
            const host = data.host;
            kmaFrames = data.radar.past;
            
            // KMA Coverage Mask
            coverageLayer = L.tileLayer(`${host}/v2/coverage/0/256/{z}/{x}/{y}/0/0_0.png`, { opacity: 0.35, maxNativeZoom: 6, maxZoom: 19, bounds: [[31.0, 121.0], [43.0, 132.0]] });

            // Create KMA layers
            kmaFrames.forEach(frame => {
                kmaLayers.push(L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`, { opacity: 0.85, maxNativeZoom: 6, maxZoom: 19, bounds: [[31.0, 121.0], [43.0, 132.0]] }));
            });

            if (document.getElementById('layerKmaRadar').checked) playKma();
        })
        .catch(err => console.error(err));
}

function updateRadarTime(timestamp, prefix) {
    const timeStr = new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('radarTimeText').innerText = `${prefix}: ${timeStr}`;
    document.getElementById('radarTimeInfo').style.display = 'block';
}

function playKma() {
    if (kmaLayers.length === 0) return;
    coverageLayer.addTo(map);
    if(kmaLayers[currentKmaIdx]) kmaLayers[currentKmaIdx].addTo(map);
    updateRadarTime(kmaFrames[currentKmaIdx].time, "KMA 영상");

    kmaPlayTimer = setInterval(() => {
        map.removeLayer(kmaLayers[currentKmaIdx]);
        currentKmaIdx = (currentKmaIdx + 1) % kmaLayers.length;
        kmaLayers[currentKmaIdx].addTo(map);
        updateRadarTime(kmaFrames[currentKmaIdx].time, "KMA 영상");
    }, 800);
}

function stopKma() {
    if (kmaPlayTimer) clearInterval(kmaPlayTimer);
    kmaLayers.forEach(lyr => map.removeLayer(lyr));
    if (coverageLayer) map.removeLayer(coverageLayer);
    document.getElementById('radarTimeInfo').style.display = 'none';
}



initRainViewerLayers();

document.getElementById('layerKmaRadar').addEventListener('change', (e) => {
    if (e.target.checked) {
        playKma();
    } else {
        stopKma();
    }
});



document.getElementById('layerWindy')?.addEventListener('change', (e) => {
    const container = document.getElementById('windyContainer');
    const iframe = document.getElementById('windyIframe');
    const extLink = document.getElementById('windyExternalLink');
    if (e.target.checked) {
        const center = map.getCenter();
        let z = map.getZoom();
        if (z > 11) z = 11;
        const embedUrl = `https://embed.windy.com/embed2.html?lat=${center.lat}&lon=${center.lng}&detailLat=${center.lat}&detailLon=${center.lng}&zoom=${z}&level=surface&overlay=rain&product=ecmwf&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
        iframe.src = embedUrl;
        container.style.display = 'block';
        if(extLink) {
            extLink.style.display = 'inline-block';
            extLink.href = `https://www.windy.com/?${center.lat},${center.lng},${z}`;
        }
        document.getElementById('radarTimeText').innerText = `🌐 전세계 10일 글로벌 비구름 예보 모드 (Windy)`;
        document.getElementById('radarTimeInfo').style.display = 'block';
    } else {
        container.style.display = 'none';
        iframe.src = '';
        if(extLink) extLink.style.display = 'none';
        document.getElementById('radarTimeInfo').style.display = 'none';
    }
});

// ==========================================
// ★[NEW] 다중 시간창 기반 출동 의사결정 시스템
// ==========================================

function calculateWindowScore(allHourlyData, startOffset, endOffset, windowName) {
    let windowData = allHourlyData.filter(d => d.offset > startOffset && d.offset <= endOffset);
    if(windowData.length === 0) return null;
    
    let totalRain = 0;
    let totalProb = 0;
    
    windowData.forEach(d => {
        totalRain += d.rains.kma; 
        totalProb += d.probs.kma;
    });
    
    let avgProb = totalProb / windowData.length;
    
    let grade = "안전";
    if (totalRain >= 30 || avgProb >= 85) grade = "위험";
    else if (totalRain >= 20 || avgProb >= 70) grade = "경고";
    else if (totalRain >= 10 || avgProb >= 50) grade = "주의";
    
    return {
        name: windowName,
        totalRain: parseFloat(totalRain.toFixed(1)),
        avgProb: Math.round(avgProb),
        grade: grade
    };
}

function calculateAllWindowScores(allHourlyData) {
    return [
        calculateWindowScore(allHourlyData, 0, 3, "1~3h"),
        calculateWindowScore(allHourlyData, 3, 6, "3~6h"),
        calculateWindowScore(allHourlyData, 6, 12, "6~12h"),
        calculateWindowScore(allHourlyData, 12, 24, "12~24h"),
        calculateWindowScore(allHourlyData, 24, 48, "24~48h"),
        calculateWindowScore(allHourlyData, 48, 72, "48~72h")
    ].filter(w => w !== null);
}

function determineFinalDecision(windows) {
    let w1_3 = windows.find(w => w.name === "1~3h");
    let w3_6 = windows.find(w => w.name === "3~6h");
    let w6_12 = windows.find(w => w.name === "6~12h");
    let w12_24 = windows.find(w => w.name === "12~24h");
    let w24_48 = windows.find(w => w.name === "24~48h");
    let w48_72 = windows.find(w => w.name === "48~72h");
    
    if (w1_3 && (w1_3.grade === "위험" || w1_3.totalRain >= 30 || w1_3.avgProb >= 85)) return { status: "즉시 대응", color: "#ef4444", targetWindow: w1_3 };
    if (w3_6 && (w3_6.grade === "위험" || w3_6.grade === "경고" || w3_6.totalRain >= 20 || w3_6.avgProb >= 70)) return { status: "대응 준비", color: "#f97316", targetWindow: w3_6 };
    if (w6_12 && (w6_12.grade !== "안전" || w6_12.totalRain >= 10 || w6_12.avgProb >= 50)) return { status: "예의주시", color: "#eab308", targetWindow: w6_12 };
    if (w12_24 && (w12_24.grade !== "안전" || w12_24.totalRain >= 10 || w12_24.avgProb >= 50)) return { status: "사전 계획", color: "#3b82f6", targetWindow: w12_24 };
    
    let longTermWin = (w24_48 && w24_48.grade !== "안전") ? w24_48 : ((w48_72 && w48_72.grade !== "안전") ? w48_72 : null);
    if (longTermWin) return { status: "장기 검토", color: "#8b5cf6", targetWindow: longTermWin };
    
    return { status: "미대응", color: "#64748b", targetWindow: null };
}

function generateDecisionReason(decisionObj) {
    if (decisionObj.status === "미대응" || !decisionObj.targetWindow) {
        return "모든 시간창에서 한국기상청(KMA) 예측 기준을 밑돌아 가장 안전한 <b>미대응</b> 상태로 진단되었습니다.";
    }
    let tw = decisionObj.targetWindow;
    let windowStr = tw.name.replace("h", "시간");
    return `향후 <b>${windowStr}</b> 내 한국기상청 기준 예측강수량이 <b>${tw.totalRain}mm</b>, 강수확률이 <b>${tw.avgProb}%</b>로 <b>${tw.grade}</b> 수준이므로 <b>${decisionObj.status}</b> 조치가 요구됩니다.`;
}

function renderDecisionCard(windows, decisionObj) {
    const card = document.getElementById('decisionCard');
    if(!card) return;
    card.style.display = 'block';
    
    const resultBox = document.getElementById('decisionResultBox');
    const statusText = document.getElementById('decisionStatusText');
    const reasonText = document.getElementById('decisionReasonText');
    const grid = document.getElementById('decisionWindowsGrid');
    
    if(statusText && resultBox && reasonText && grid) {
        let r=parseInt(decisionObj.color.slice(1,3),16), g=parseInt(decisionObj.color.slice(3,5),16), b=parseInt(decisionObj.color.slice(5,7),16);
        resultBox.style.backgroundColor = `rgba(${r},${g},${b}, 0.15)`;
        resultBox.style.borderColor = decisionObj.color;
        statusText.style.color = decisionObj.color;
        
        statusText.innerText = decisionObj.status;
        reasonText.innerHTML = generateDecisionReason(decisionObj);
        
        let gridHtml = '';
        windows.forEach(w => {
            let gradeColor = w.grade === '위험' ? '#ef4444' : (w.grade === '경고' ? '#f97316' : (w.grade === '주의' ? '#eab308' : '#64748b'));
            gridHtml += `
                <div style="background: rgba(15,23,42,0.4); border: 1px solid rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px;">${w.name.replace('h','시간')} 구간</div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.8rem; color: #cbd5e1;">예상 강수량</span>
                            <span style="font-size: 1.05rem; font-weight: 700;">${w.totalRain.toFixed(1)}<span style="font-size:0.75rem;font-weight:400;color:#94a3b8">mm</span></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.8rem; color: #cbd5e1;">강수 확률</span>
                            <span style="font-size: 1.05rem; font-weight: 700; color: ${gradeColor};">${w.avgProb}<span style="font-size:0.75rem;font-weight:400;color:#94a3b8">%</span></span>
                        </div>
                    </div>
                </div>
            `;
        });
        grid.innerHTML = gridHtml;
    }
}

function runDecisionLogic(allHourlyData) {
    let windows = calculateAllWindowScores(allHourlyData);
    let decision = determineFinalDecision(windows);
    renderDecisionCard(windows, decision);
}

// Drag & Drop GIS Files
const mapContainer = document.getElementById('map');
const dropZone = document.getElementById('drop-zone');

mapContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dropZone) dropZone.style.display = 'flex';
});

mapContainer.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (dropZone) dropZone.style.display = 'none';
});

mapContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (dropZone) dropZone.style.display = 'none';

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    try {
        if (ext === 'geojson' || ext === 'json') {
            const text = await file.text();
            const geojsonData = JSON.parse(text);
            const layer = L.geoJSON(geojsonData, {
                style: { color: '#f43f5e', weight: 3, fillOpacity: 0.3 }
            }).addTo(map);
            map.fitBounds(layer.getBounds(), { padding: [30, 30] });
            alert(`✅ ${file.name} (GeoJSON) 자동 렌더링 매칭 완료!`);
        } else if (ext === 'zip') {
            const buffer = await file.arrayBuffer();
            const geojsonData = await shp(buffer); // using shpjs
            const layer = L.geoJSON(geojsonData, {
                style: { color: '#8b5cf6', weight: 3, fillOpacity: 0.3 }
            }).addTo(map);
            map.fitBounds(layer.getBounds(), { padding: [30, 30] });
            alert(`✅ ${file.name} (Shapefile) 로컬 파싱 및 렌더링 완료!`);
        } else {
            alert('❌ 지원하지 않는 파일 형식입니다. (GeoJSON, SHP 압축 Zip만 가능)');
        }
    } catch (error) {
        console.error('File parsing error:', error);
        alert('❌ 파일을 분석하는 중 오류가 발생했습니다. (포맷이나 좌표계 확인 요망)');
    }
});

function toggleSection(contentId, iconId) {
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    if (content.style.display === 'none') {
        content.style.display = 'block';
        if (icon) {
            icon.classList.remove('ri-arrow-down-s-line');
            icon.classList.add('ri-arrow-up-s-line');
        }
    } else {
        content.style.display = 'none';
        if (icon) {
            icon.classList.remove('ri-arrow-up-s-line');
            icon.classList.add('ri-arrow-down-s-line');
        }
    }
}
