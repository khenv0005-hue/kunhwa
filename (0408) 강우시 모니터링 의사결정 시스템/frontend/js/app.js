const map = L.map('map', { zoomControl: false }).setView([37.55, 126.97], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const baseMapLayers = {
    vworld: L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© Vworld', className: 'vworld-2d-filter' }),
    vworld_sat: L.tileLayer('https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg', { maxZoom: 19, attribution: '© Vworld', className: 'vworld-sat-filter' }),
    topo: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    cartodark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors, © CARTO' }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
};

let currentBaseLayer = baseMapLayers.vworld;
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

// ==========================================
// ★ UI 패널 및 아코디언 토글 제어
// ==========================================
function toggleSidePanel(side) {
    const panel = document.getElementById(side + 'Panel');
    const toggleBtn = document.getElementById(side + 'PanelToggle');
    const icon = toggleBtn.querySelector('i');
    
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        toggleBtn.classList.remove('collapsed');
        if (side === 'left') icon.className = 'ri-arrow-left-s-line';
        if (side === 'right') icon.className = 'ri-arrow-right-s-line';
    } else {
        panel.classList.add('collapsed');
        toggleBtn.classList.add('collapsed');
        if (side === 'left') icon.className = 'ri-arrow-right-s-line';
        if (side === 'right') icon.className = 'ri-arrow-left-s-line';
    }
}

const investigationMarker = L.marker([37.525, 127.02], { icon: invPointIcon }).addTo(map)
    .bindPopup(`<b>선택 지점 (조사/채수)</b><br>최적 채수 시간: 자동계산중...`);

let currentLat = 37.525;
let currentLng = 127.02;
let currentDryDays = 0;   // 현재 기준 선행무강우일수
let lastRainMs = null;    // 마지막 강우 시점 타임스탬프 (ms)

map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    currentLat = lat;
    currentLng = lng;
    
    // 검색 시 생성된 빨간 박스 제거
    if (searchBoundingBox) {
        map.removeLayer(searchBoundingBox);
        searchBoundingBox = null;
    }

    investigationMarker.setLatLng([lat, lng]);
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const favIcon = isFavorite(lat, lng) ? '<i class="ri-star-fill" style="color:#facc15;"></i>' : '<i class="ri-star-line"></i>';
    const favBtn = `<button onclick="togglePointFavorite(${lat}, ${lng})" id="favBtn_${key}" style="background:none; border:none; cursor:pointer; font-size:1.2rem; color:#cbd5e1; padding:2px 4px; outline:none; flex-shrink:0;" title="즐겨찾기 토글">${favIcon}</button>`;

    investigationMarker.setPopupContent(`<div style="min-width:200px;"><div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;"><b>지점 선택됨</b>${favBtn}</div><span style="font-size:0.8rem;color:#94a3b8;">위도: ${lat.toFixed(4)} / 경도: ${lng.toFixed(4)}</span><div style="font-size:0.75rem;color:#94a3b8;margin-top:4px;">⏳ 선행무강우일수 조회 중...</div></div>`).openPopup();
    
    document.getElementById('currentLocText').innerText = `선택 지점 (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
    document.getElementById('updateBtn').style.boxShadow = '0 0 15px #10b981';

    // ★ 클릭 즉시 선행무강우일수(ADD) 자동 조회
    fetchAntecedentDryDays(lat, lng);
});

function manualUpdate() {
    updatePointData(currentLat, currentLng);
    document.getElementById('updateBtn').style.boxShadow = 'none';
}

// 1시간(3,600,000ms) 간격으로 현재 선택된 지점의 기상/예측 데이터 자동 갱신
setInterval(() => {
    console.log('선택 지점 기상 데이터 1시간 주기 자동 갱신');
    manualUpdate();
}, 3600000);

// ==========================================
// ★ 선행무강우일수 (ADD: Antecedent Dry Days) 산출
// Open-Meteo 과거 60일 일강수 데이터를 역순 탐색하여 산정
// ==========================================
async function fetchAntecedentDryDays(lat, lng) {
    const addCard = document.getElementById('addCard');
    const addContent = document.getElementById('addContent');
    if (addCard) addCard.style.display = 'block';
    if (addContent) addContent.innerHTML = `<div style="text-align:center; padding:12px; color:#94a3b8; font-size:0.85rem;"><i class="ri-loader-4-line" style="animation:spin 1s linear infinite; display:inline-block;"></i> 과거 강수 이력 조회 중...</div>`;

    try {
        const today = new Date();
        const endDate = new Date(today); endDate.setDate(endDate.getDate() - 1);
        const startDate = new Date(today); startDate.setDate(startDate.getDate() - 60);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}&daily=precipitation_sum&timezone=Asia%2FSeoul`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.reason || 'Archive API Error');

        const dates = data.daily.time;
        const precips = data.daily.precipitation_sum;

        let dryDays = 0;
        let lastRainDate = null;
        let lastRainAmount = 0;
        let recentRains = [];

        for (let i = dates.length - 1; i >= 0; i--) {
            const rain = precips[i] || 0;
            if (rain >= 0.5) {
                if (!lastRainDate) {
                    lastRainDate = dates[i];
                    lastRainAmount = rain;
                }
                if (recentRains.length < 5) {
                    recentRains.push({ date: dates[i], amount: rain });
                }
                if (recentRains.length >= 5) break;
            } else {
                if (!lastRainDate) dryDays++;
            }
        }

        if (!lastRainDate) {
            dryDays = dates.length + 1;
        } else {
            const lastRainTimeMs = new Date(lastRainDate).getTime();
            const todayMs = today.getTime();
            dryDays = Math.floor((todayMs - lastRainTimeMs) / (1000 * 60 * 60 * 24));
        }

        lastRainMs = lastRainDate ? new Date(lastRainDate).getTime() : null;
        currentDryDays = dryDays;
        
        renderAntecedentDryDays(dryDays, lastRainDate, lastRainAmount, recentRains, lat, lng);

    } catch(e) {
        console.error('ADD fetch error:', e);
        if (addContent) addContent.innerHTML = `<div style="text-align:center; padding:12px; color:#f43f5e; font-size:0.85rem;">⚠️ 선행무강우일수 조회 실패<br><span style="font-size:0.75rem;color:#94a3b8;">${e.message}</span></div>`;
        const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
        const favIcon = isFavorite(lat, lng) ? '<i class="ri-star-fill" style="color:#facc15;"></i>' : '<i class="ri-star-line"></i>';
        const favBtn = `<button onclick="togglePointFavorite(${lat}, ${lng})" id="favBtn_${key}" style="position:absolute; top:8px; right:30px; background:none; border:none; cursor:pointer; font-size:1.2rem; color:#cbd5e1; padding:0; outline:none;" title="즐겨찾기 토글">${favIcon}</button>`;
        investigationMarker.setPopupContent(`<div style="position:relative; padding-right:20px;"><b>지점 선택됨</b>${favBtn}<br>위도: ${lat.toFixed(4)}<br>경도: ${lng.toFixed(4)}<br><div style="font-size:0.75rem;color:#f43f5e;margin-top:4px;">⚠️ ADD 조회 실패</div></div>`);
    }
}

function renderAntecedentDryDays(dryDays, lastRainDate, lastRainAmount, recentRains, lat, lng) {
    window.globalRecentRains = recentRains; // 최근 강우 이력을 대시보드에서도 쓸 수 있게 전역 저장
    
    let addGrade, addColor, addIcon, addDesc;
    if (dryDays >= 14) {
        addGrade = '매우 높음'; addColor = '#ef4444'; addIcon = 'ri-error-warning-fill';
        addDesc = '장기 건조 → 초기우수 오염 극대화 예상';
    } else if (dryDays >= 7) {
        addGrade = '높음'; addColor = '#f97316'; addIcon = 'ri-alarm-warning-line';
        addDesc = '오염물질 축적 상당 → 초기세척 주의';
    } else if (dryDays >= 3) {
        addGrade = '보통'; addColor = '#eab308'; addIcon = 'ri-information-line';
        addDesc = '일반적 건기 수준 → 보통 오염부하';
    } else {
        addGrade = '낮음'; addColor = '#10b981'; addIcon = 'ri-shield-check-line';
        addDesc = '최근 강우 발생 → 축적 오염 적음';
    }

    const formattedDate = lastRainDate ? lastRainDate.replace(/-/g, '.') : '-';
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const favIcon = isFavorite(lat, lng) ? '<i class="ri-star-fill" style="color:#facc15;"></i>' : '<i class="ri-star-line"></i>';
    const favBtn = `<button onclick="togglePointFavorite(${lat}, ${lng})" id="favBtn_${key}" style="background:none; border:none; cursor:pointer; font-size:1.2rem; color:#cbd5e1; padding:2px 4px; outline:none; flex-shrink:0;" title="즐겨찾기 토글">${favIcon}</button>`;
    
    investigationMarker.setPopupContent(
        `<div style="min-width:200px;">` +
        `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">` +
        `<b style="font-size:1rem;">📍 지점 선택됨</b>${favBtn}</div>` +
        `<span style="font-size:0.8rem;color:#94a3b8;">위도: ${lat.toFixed(4)} / 경도: ${lng.toFixed(4)}</span>` +
        `<hr style="border:none;border-top:1px solid rgba(0,0,0,0.15);margin:6px 0;">` +
        `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">` +
        `<span style="font-size:0.8rem;">☀️ 선행무강우일수</span>` +
        `<span style="font-size:1.3rem;font-weight:800;color:${addColor};">${dryDays}일</span>` +
        `</div>` +
        `<div style="font-size:0.75rem;color:#666;margin-bottom:4px;">${addDesc}</div>` +
        (lastRainDate ?
            `<div style="font-size:0.8rem;margin-top:2px;">🌧️ 최근 강우: <b>${formattedDate}</b> (${lastRainAmount}mm)</div>` :
            `<div style="font-size:0.8rem;color:#999;">60일 내 유효강우(≥0.5mm) 없음</div>`) +
        `<hr style="border:none;border-top:1px solid rgba(0,0,0,0.15);margin:6px 0;">` +
        `<div style="font-size:0.72rem;color:#10b981;">상단 [데이터 갱신]으로 72h 예측 조회</div>` +
        `</div>`
    ).openPopup();

    const addContent = document.getElementById('addContent');
    if (!addContent) return;

    let historyHtml = '';
    if (recentRains.length > 0) {
        historyHtml = `<div style="margin-top:12px;"><div style="font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">최근 강우 이력 (유효강우 ≥ 0.5mm)</div>`;
        recentRains.forEach(r => {
            const barWidth = Math.min(r.amount / 50 * 100, 100);
            const dateFormatted = r.date.substring(5).replace('-', '/');
            historyHtml += `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:0.8rem;">
                    <span style="width:50px;color:#94a3b8;flex-shrink:0;">${dateFormatted}</span>
                    <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                        <div style="width:${barWidth}%;height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:3px;"></div>
                    </div>
                    <span style="width:55px;text-align:right;font-weight:600;flex-shrink:0;">${r.amount}<span style="font-size:0.7rem;color:#94a3b8;">mm</span></span>
                </div>`;
        });
        historyHtml += `</div>`;
    }

    const rgbMap = { '#ef4444': '239,68,68', '#f97316': '249,115,22', '#eab308': '234,179,8', '#10b981': '16,185,129' };
    const rgb = rgbMap[addColor] || '94,148,150';

    addContent.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:48px;height:48px;border-radius:12px;background:rgba(${rgb},0.15);display:flex;align-items:center;justify-content:center;">
                    <i class="${addIcon}" style="font-size:1.5rem;color:${addColor};"></i>
                </div>
                <div>
                    <div style="font-size:0.75rem;color:#94a3b8;">선행무강우일수 (ADD)</div>
                    <div style="font-size:1.8rem;font-weight:800;color:${addColor};line-height:1;">${dryDays}<span style="font-size:0.9rem;font-weight:500;color:#cbd5e1;">일</span></div>
                </div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.7rem;color:#64748b;">비점오염 축적도</div>
                <div style="font-size:0.95rem;font-weight:700;color:${addColor};">${addGrade}</div>
            </div>
        </div>
        <div style="background:rgba(${rgb},0.08);border-left:3px solid ${addColor};padding:8px 12px;border-radius:0 8px 8px 0;margin-bottom:8px;">
            <div style="font-size:0.8rem;color:#cbd5e1;"><i class="${addIcon}" style="color:${addColor};margin-right:4px;"></i>${addDesc}</div>
        </div>
        ${lastRainDate ?
            `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(59,130,246,0.08); border-radius:8px;">
                <div>
                    <div style="font-size:0.7rem;color:#94a3b8;">최근 강우일</div>
                    <div style="font-size:0.95rem;font-weight:600;color:#60a5fa;">🌧️ ${formattedDate}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.7rem;color:#94a3b8;">강수량</div>
                    <div style="font-size:1.1rem;font-weight:700;">${lastRainAmount}<span style="font-size:0.75rem;color:#94a3b8;">mm</span></div>
                </div>
            </div>` :
            `<div style="text-align:center;padding:8px;font-size:0.8rem;color:#64748b;">60일 내 유효강우(≥0.5mm) 기록 없음</div>`}
        ${historyHtml}
        <div style="margin-top:8px;font-size:0.65rem;color:#475569;text-align:right;">※ 기준: 일강수량 ≥ 0.5mm (기상청 유효강우 기준) | Open-Meteo Archive</div>
    `;
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
window.currentSearchResults = [];

window.selectLocationResult = function(index) {
    const loc = window.currentSearchResults[index];
    const bounds = [
        [parseFloat(loc.boundingbox[0]), parseFloat(loc.boundingbox[2])],
        [parseFloat(loc.boundingbox[1]), parseFloat(loc.boundingbox[3])]
    ];

    if (searchBoundingBox) map.removeLayer(searchBoundingBox);
    searchBoundingBox = L.rectangle(bounds, { color: "#ef4444", weight: 3, fillOpacity: 0.1 }).addTo(map);

    map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
    
    // 주소명 포맷 (너무 길 경우 첫 부분만 추출)
    let shortName = loc.display_name.split(',')[0];
    document.getElementById('currentLocText').innerText = shortName;
    document.getElementById('searchResultsDropdown').style.display = 'none';
};

// 화면 이외 공간 클릭 시 드롭다운 닫기
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (dropdown && !dropdown.contains(event.target) && event.target.id !== 'addressSearch' && !event.target.closest('button[onclick="searchLocation()"]')) {
        dropdown.style.display = 'none';
    }
});

// 주소 검색 히스토리 관리
window.showSearchHistory = function() {
    const dropdown = document.getElementById('searchResultsDropdown');
    const input = document.getElementById('addressSearch');
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    
    // 주소입력창에 텍스트가 있으면 히스토리 대신 검색결과를 기다릴 수 있도록 함 (클릭 시에만)
    if (input.value.trim() !== '') return;

    if (history.length > 0) {
        let hHtml = '<div style="padding: 10px 12px; background: rgba(59,130,246,0.1); border-bottom: 1px solid rgba(59,130,246,0.3); color:#60a5fa; font-size:0.8rem; font-weight:600; display:flex; justify-content:space-between; align-items:center;">';
        hHtml += '<span>최근 검색 기록</span><span onclick="clearHistory()" style="cursor:pointer; font-size:0.7rem; color:#94a3b8; text-decoration:underline;">전체 삭제</span></div>';
        
        history.forEach((q, idx) => {
            hHtml += `<div style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; color: #e2e8f0; font-size: 0.85rem; display:flex; align-items:center; justify-content:space-between;" 
                onclick="useHistoryItem('${q}')" onmouseover="this.style.background='rgba(59,130,246,0.2)'" onmouseout="this.style.background='transparent'">
                <div style="display:flex; align-items:center; flex-grow:1;">
                    <i class="ri-history-line" style="color: #94a3b8; margin-right: 10px; font-size:0.9rem;"></i> ${q}
                </div>
            </div>`;
        });
        dropdown.innerHTML = hHtml;
        dropdown.style.display = 'flex';
    }
};

window.saveSearchQuery = function(query) {
    if (!query) return;
    let history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    // 중복 제거 및 최상단 이동
    history = history.filter(item => item !== query);
    history.unshift(query);
    // 10개 제한
    history = history.slice(0, 10);
    localStorage.setItem('searchHistory', JSON.stringify(history));
};

window.clearHistory = function() {
    localStorage.removeItem('searchHistory');
    document.getElementById('searchResultsDropdown').style.display = 'none';
};

window.useHistoryItem = function(query) {
    document.getElementById('addressSearch').value = query;
    searchLocation();
};

async function searchLocation() {
    const query = document.getElementById('addressSearch').value;
    const dropdown = document.getElementById('searchResultsDropdown');
    if (dropdown) dropdown.style.display = 'none';
    if (!query) return;
    
    // 검색어 저장
    saveSearchQuery(query);
    
    document.getElementById('currentLocText').innerText = '검색 중...';
    try {
        // 주소 검색 (한국어로 된 상세 주소도 찾도록 lang 옵션 추가)
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&accept-language=ko`);
        const data = await response.json();
        
        if (data && data.length > 0) {
            window.currentSearchResults = data;
            
            if (data.length === 1) {
                // 단일 결과면 자동 선택
                selectLocationResult(0);
            } else {
                // 다중 검색(동명이인)일 경우 UI에 드롭다운 표출
                if (dropdown) {
                    let listHtml = '<div style="padding: 10px 12px; background: rgba(59,130,246,0.1); border-bottom: 1px solid rgba(59,130,246,0.3); color:#60a5fa; font-size:0.8rem; font-weight:600;">여러 위치가 발견되었습니다. 정확한 위치를 선택하세요.</div>';
                    data.forEach((loc, index) => {
                        let shortName = loc.display_name.split(',')[0];
                        listHtml += `<div style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: pointer; color: #e2e8f0; font-size: 0.85rem; transition: 0.2s;" 
                            onclick="selectLocationResult(${index})" onmouseover="this.style.background='rgba(59,130,246,0.2)'" onmouseout="this.style.background='transparent'">
                            <div style="display:flex; align-items:center;">
                                <i class="ri-map-pin-line" style="color: #60a5fa; margin-right: 6px;"></i> <b style="font-size: 0.95rem;">${shortName}</b>
                            </div>
                            <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px; line-height: 1.3;">${loc.display_name}</div>
                            <div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">Lat: ${parseFloat(loc.lat).toFixed(3)}, Lng: ${parseFloat(loc.lon).toFixed(3)}</div>
                        </div>`;
                    });
                    dropdown.innerHTML = listHtml;
                    dropdown.style.display = 'flex';
                }
                document.getElementById('currentLocText').innerText = `검색결과: ${data.length}건 (목록서 선택)`;
            }
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
let activeModelFilters = { kma: true, best: true };

window.toggleModelFilter = function(checkbox) {
    const model = checkbox.getAttribute('data-model');
    activeModelFilters[model] = checkbox.checked;
    
    // 차트 업데이트 (Chart.js dataset hiding)
    if (precipChartObj) {
        const modelToIdx = { kma: 0, best: 1 };
        const idx = modelToIdx[model];
        if (idx !== undefined) {
            precipChartObj.setDatasetVisibility(idx, checkbox.checked);
            precipChartObj.update();
        }
    }
    
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

async function updatePointData(lat, lng) {
    if (!lat || !lng) {
        alert("지도를 클릭하여 정확한 지점을 먼저 선택해주세요.");
        return;
    }
    const tbody = document.getElementById('precipTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;"><i class="ri-loader-4-line ri-spin"></i> 기상청(KMA) 데이터 수신 중...</td></tr>';
    
    console.log(`[DEBUG] updatePointData 호출됨: lat=${lat}, lng=${lng}`);
    
    try {
        const grid = dfs_xy_conv("toXY", lat, lng);
        const nx = grid.x;
        const ny = grid.y;
        
        const apiKey = encodeURIComponent("Bclip8wR9Tcgz/jPEcTpnhuAyyrGeu6kW0vTxi1ItGQMKH7OTLdAgYwQZvF1qu3BZSN2bBo6G2Dg7Gl3/X4qoQ==");
        
        // --- 1. 초단기실황 (현재 기상) ---
        let nowNcst = new Date();
        if (nowNcst.getMinutes() < 40) nowNcst.setHours(nowNcst.getHours() - 1);
        let ncstDate = `${nowNcst.getFullYear()}${String(nowNcst.getMonth() + 1).padStart(2, '0')}${String(nowNcst.getDate()).padStart(2, '0')}`;
        let ncstTime = `${String(nowNcst.getHours()).padStart(2, '0')}00`;
        const urlNcst = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${apiKey}&pageNo=1&numOfRows=100&dataType=JSON&base_date=${ncstDate}&base_time=${ncstTime}&nx=${nx}&ny=${ny}`;
        
        // --- 2. 단기예보 (72시간 예측) ---
        let nowFcst = new Date();
        nowFcst.setMinutes(nowFcst.getMinutes() - 15);
        let h = nowFcst.getHours();
        let baseH = 23; let subDay = false;
        if (h < 2) { baseH = 23; subDay = true; }
        else if (h < 5) baseH = 2; else if (h < 8) baseH = 5; else if (h < 11) baseH = 8;
        else if (h < 14) baseH = 11; else if (h < 17) baseH = 14; else if (h < 20) baseH = 17;
        else if (h < 23) baseH = 20; else baseH = 23;
        if (subDay) nowFcst.setDate(nowFcst.getDate() - 1);
        
        let fcstDate = `${nowFcst.getFullYear()}${String(nowFcst.getMonth() + 1).padStart(2, '0')}${String(nowFcst.getDate()).padStart(2, '0')}`;
        let fcstTime = `${String(baseH).padStart(2, '0')}00`;
        const urlFcst = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${apiKey}&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${fcstDate}&base_time=${fcstTime}&nx=${nx}&ny=${ny}`;

        // --- 3. Open-Meteo (KMA seamless) 예측 ---
        const urlOm = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,precipitation&hourly=precipitation,precipitation_probability&models=kma_seamless&timezone=Asia%2FSeoul&past_days=1&forecast_days=4`;

        const [resNcst, resFcst, resOm] = await Promise.all([fetch(urlNcst), fetch(urlFcst), fetch(urlOm)]);
        const ncstRaw = await resNcst.json();
        const fcstRaw = await resFcst.json();
        const omRaw = await resOm.json();
        
        if (ncstRaw.response.header.resultCode !== "00" || fcstRaw.response.header.resultCode !== "00") {
            throw new Error("KMA API 오류 발생");
        }
        if (omRaw.error) {
            throw new Error(omRaw.reason || "Open-Meteo API 오류 발생");
        }
        
        let data = { 
            current: { temperature_2m: 0, weather_code: 0, precipitation: 0 }, 
            hourly: { 
                time: [], 
                precipitation_kma: [], precipitation_probability_kma: [],
                precipitation_om: [], precipitation_probability_om: []
            } 
        };
        
        // 현재 기상 파싱 (KMA 우선 반영)
        let pty = "0", tmp = 0, rn1 = 0;
        ncstRaw.response.body.items.item.forEach(it => {
            if (it.category === 'T1H') tmp = parseFloat(it.obsrValue);
            if (it.category === 'RN1') rn1 = parseFloat(it.obsrValue);
            if (it.category === 'PTY') pty = it.obsrValue;
        });
        
        data.current.temperature_2m = tmp;
        data.current.precipitation = rn1;
        if (pty === "1" || pty === "5") data.current.weather_code = 61; // 비
        else if (pty === "2" || pty === "6") data.current.weather_code = 63; // 비/눈
        else if (pty === "3" || pty === "7") data.current.weather_code = 71; // 눈
        else if (pty === "4") data.current.weather_code = 65; // 소나기
        else if (rn1 > 0) data.current.weather_code = 61;
        else data.current.weather_code = 1; // 맑음 기본
        
        console.log(`[KMA 실황] 격자: nx=${nx}, ny=${ny} | base: ${ncstDate} ${ncstTime}`)
        console.log(`[KMA 실황] PTY="${pty}" (type:${typeof pty}), T1H=${tmp}, RN1=${rn1}, → weather_code=${data.current.weather_code}`);
        
        // 72시간 예보 파싱 (KMA)
        let hourlyMap = {}; 
        fcstRaw.response.body.items.item.forEach(it => {
            let dt = `${it.fcstDate.substring(0,4)}-${it.fcstDate.substring(4,6)}-${it.fcstDate.substring(6,8)}T${it.fcstTime.substring(0,2)}:00`;
            if (!hourlyMap[dt]) hourlyMap[dt] = { pop: 0, pcp: 0 };
            
            if (it.category === 'POP') hourlyMap[dt].pop = parseFloat(it.fcstValue) || 0;
            if (it.category === 'PCP') {
                if (it.fcstValue === "강수없음") hourlyMap[dt].pcp = 0;
                else hourlyMap[dt].pcp = parseFloat(it.fcstValue) || 0;
            }
        });
        
        // 데이터 병합 시작
        let times = Object.keys(hourlyMap).sort();
        let omTimes = omRaw.hourly.time;
        
        let now = new Date();
        let currentIsoStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
        
        // ★ 현재 비가 오고 있으면 과거 48시간 KMA 실황 조회하여 이벤트 시작점 탐색
        let pastHourlyData = []; // { time, rn1 }
        if (pty !== "0" || rn1 > 0) {
            console.log("[KMA 과거] 현재 강수 감지 → 과거 48시간 실황 조회 시작");
            const pastFetches = [];
            for (let h = 1; h <= 48; h++) {
                const pastTime = new Date(now.getTime() - h * 3600000);
                const pDate = `${pastTime.getFullYear()}${String(pastTime.getMonth()+1).padStart(2,'0')}${String(pastTime.getDate()).padStart(2,'0')}`;
                const pTime = `${String(pastTime.getHours()).padStart(2,'0')}00`;
                const pIso = `${pastTime.getFullYear()}-${String(pastTime.getMonth()+1).padStart(2,'0')}-${String(pastTime.getDate()).padStart(2,'0')}T${String(pastTime.getHours()).padStart(2,'0')}:00`;
                const pUrl = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${apiKey}&pageNo=1&numOfRows=10&dataType=JSON&base_date=${pDate}&base_time=${pTime}&nx=${nx}&ny=${ny}`;
                
                pastFetches.push(
                    fetch(pUrl).then(r => r.json()).then(d => {
                        let pr = 0;
                        if (d.response && d.response.header.resultCode === "00") {
                            d.response.body.items.item.forEach(it => {
                                if (it.category === 'RN1') pr = parseFloat(it.obsrValue) || 0;
                            });
                        }
                        return { time: pIso, rn1: pr };
                    }).catch(() => ({ time: pIso, rn1: 0 }))
                );
            }
            pastHourlyData = await Promise.all(pastFetches);
            pastHourlyData.sort((a, b) => a.time.localeCompare(b.time));
            console.log(`[KMA 과거] ${pastHourlyData.length}시간 데이터 수신 완료`);
        }
        
        // 과거 데이터를 배열 앞에 추가 (중복 시간 제외)
        if (pastHourlyData.length > 0) {
            let pastTimes = [];
            let pastKma = [];
            let pastKmaProb = [];
            let pastOm = [];
            let pastOmProb = [];
            
            pastHourlyData.forEach(pd => {
                if (!times.includes(pd.time)) { // 미래 데이터와 중복 방지
                    pastTimes.push(pd.time);
                    pastKma.push(pd.rn1);
                    pastKmaProb.push(0); // 과거는 확률 없음
                    pastOm.push(0);
                    pastOmProb.push(0);
                }
            });
            
            // 과거 데이터를 앞에 붙이기
            data.hourly.time = [...pastTimes, ...data.hourly.time];
            data.hourly.precipitation_kma = [...pastKma, ...data.hourly.precipitation_kma];
            data.hourly.precipitation_probability_kma = [...pastKmaProb, ...data.hourly.precipitation_probability_kma];
            data.hourly.precipitation_om = [...pastOm, ...data.hourly.precipitation_om];
            data.hourly.precipitation_probability_om = [...pastOmProb, ...data.hourly.precipitation_probability_om];
        }
        
        times.forEach(t => {
            data.hourly.time.push(t);
            data.hourly.precipitation_kma.push(hourlyMap[t].pcp);
            data.hourly.precipitation_probability_kma.push(hourlyMap[t].pop);
            
            let omIdx = omTimes.indexOf(t);
            if (omIdx !== -1) {
                let omPcp = 0;
                if (omRaw.hourly.precipitation_kma_seamless) omPcp = omRaw.hourly.precipitation_kma_seamless[omIdx] || 0;
                else if (omRaw.hourly.precipitation) omPcp = omRaw.hourly.precipitation[omIdx] || 0;
                
                let omPop = 0;
                if (omRaw.hourly.precipitation_probability_kma_seamless) omPop = omRaw.hourly.precipitation_probability_kma_seamless[omIdx] || 0;
                else if (omRaw.hourly.precipitation_probability) {
                    let v = omRaw.hourly.precipitation_probability[omIdx];
                    omPop = (v !== null && v !== undefined) ? v : 0;
                }
                data.hourly.precipitation_om.push(omPcp);
                data.hourly.precipitation_probability_om.push(omPop);
            } else {
                data.hourly.precipitation_om.push(0);
                data.hourly.precipitation_probability_om.push(0);
            }
        });
        
        // 실시간 UI 업데이트
        const tempEl = document.getElementById('currentTemp');
        const statusEl = document.getElementById('currentStatus');
        const iconEl = document.getElementById('currentWeatherIcon');
        
        if (tempEl) tempEl.innerText = `${data.current.temperature_2m.toFixed(1)}°C`;
        
        const weatherMap = {
            1: { icon: 'ri-sun-cloudy-line', text: '대체로 맑음', color: '#f59e0b' },
            61: { icon: 'ri-rainy-line', text: '비 (약함)', color: '#3b82f6' },
            63: { icon: 'ri-rainy-line', text: '비/눈', color: '#2563eb' },
            65: { icon: 'ri-showers-line', text: '강한 비/호우', color: '#1d4ed8' },
            71: { icon: 'ri-snowy-line', text: '약한 눈', color: '#f8fafc' }
        };
        const weather = weatherMap[data.current.weather_code] || { icon: 'ri-sun-cloudy-line', text: '기상청(KMA)', color: '#94a3b8' };
        if (statusEl) statusEl.innerText = `${weather.text} (실시간: ${data.current.precipitation} mm/h)`;
        if (iconEl) { iconEl.className = `${weather.icon} weather-icon`; iconEl.style.color = weather.color; }
        
        window.lastWeatherFetchData = data;
        renderWeatherUI();
        
        if (typeof runDecisionLogic === 'function') {
            const allHourlyData = [];
            // targetTime 위치 찾기
            let currentIndex = data.hourly.time.indexOf(currentIsoStr);
            if (currentIndex === -1) {
                // 완전히 매칭되지 않으면 가장 가까운 첫번째 시간을 사용 (ex. 약간 미래)
                currentIndex = 0; 
                for (let j = 0; j < data.hourly.time.length; j++) {
                    if (data.hourly.time[j] >= currentIsoStr) { currentIndex = j; break; }
                }
            }
            
            for(let offset = 0; offset <= 72; offset++) {
                let i = currentIndex + offset;
                if (i < 0 || i >= data.hourly.time.length) break;
                allHourlyData.push({
                    offset: offset,
                    rains: { 
                        kma: data.hourly.precipitation_kma[i] || 0,
                        best: data.hourly.precipitation_om[i] || 0
                    },
                    probs: { 
                        kma: data.hourly.precipitation_probability_kma[i] || 0,
                        best: data.hourly.precipitation_probability_om[i] || 0
                    }
                });
            }
            runDecisionLogic(allHourlyData, data, currentIndex);
            
            if (typeof renderMonitoringCard === 'function') {
                renderMonitoringCard(data, currentIndex);
            }
        }
    } catch(e) {
        console.error("KMA Data Error:", e);
        alert("[디버그] KMA API 에러: " + e.message);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f43f5e; padding: 20px;">외부 기상 데이터(API) 연결에 실패했습니다.<br><small style="color:#94a3b8; font-size:0.75rem;">(기상청 데이터 포털 지연 또는 일일 한도초과)</small></td></tr>`;
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
    let omData = [];
    
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
        
        let bestRainKma = data.hourly.precipitation_kma ? (data.hourly.precipitation_kma[i] || 0) : 0;
        let bestProbKma = data.hourly.precipitation_probability_kma ? (data.hourly.precipitation_probability_kma[i] || 0) : 0;
        
        let bestRainOm = data.hourly.precipitation_om ? (data.hourly.precipitation_om[i] || 0) : 0;
        let bestProbOm = data.hourly.precipitation_probability_om ? (data.hourly.precipitation_probability_om[i] || 0) : 0;
        
        kmaData.push(bestRainKma);
        omData.push(bestRainOm);
        
        if (numActive > 0) {
            let timeCellAdded = false;
            
            // 모델별 메타데이터 매핑
            const modelMeta = {
                kma: { label: '한국(KMA)', rain: bestRainKma, prob: bestProbKma, color: '#3b82f6' },
                best: { label: 'Open-Meteo', rain: bestRainOm, prob: bestProbOm, color: '#8b5cf6' }
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
        precipChartObj.data.datasets[1].data = omData;
        
        // 차트 필터 상태 동기화
        Object.entries(activeModelFilters).forEach(([model, active]) => {
            const modelToIdx = { kma: 0, best: 1 };
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
            { label: 'Open-Meteo', data: [], borderColor: '#8b5cf6', tension: 0.4 }
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
                        const modelMap = { 0: 'kma', 1: 'best' };
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
    let rainHoursCount = 0;
    
    windowData.forEach(d => {
        totalRain += d.rains.kma; 
        if (d.probs.kma > 0) {
            totalProb += d.probs.kma;
            rainHoursCount++;
        }
    });
    
    let avgProb = rainHoursCount > 0 ? (totalProb / rainHoursCount) : 0;
    
    let status = "미대응";
    if (totalRain >= 30 && avgProb >= 50) {
        status = "대응 시작";
    }
    
    return {
        name: windowName,
        totalRain: parseFloat(totalRain.toFixed(1)),
        avgProb: Math.round(avgProb),
        status: status
    };
}

function calculateAllWindowScores(allHourlyData) {
    return [
        calculateWindowScore(allHourlyData, 0, 6, "현재~6h"),
        calculateWindowScore(allHourlyData, 0, 12, "현재~12h"),
        calculateWindowScore(allHourlyData, 0, 24, "현재~24h"),
        calculateWindowScore(allHourlyData, 0, 72, "현재~72h")
    ].filter(w => w !== null);
}

function determineFinalDecision(windows, allHourlyData) {
    let w6_12  = windows.find(w => w.name === "현재~12h");
    let w12_24 = windows.find(w => w.name === "현재~24h");
    const w24_72 = allHourlyData ? calculateWindowScore(allHourlyData, 0, 72, "현재~72h") : windows.find(w => w.name === "현재~72h");

    // 🚨 대응 시작: 현재 시간창 중 어느 곳이든 30mm/50% 조건을 넘으면
    // 가장 먼저 조건이 충족되는 시간창부터 확인하여 우선 타겟으로 함
    if (w6_12 && w6_12.status === "대응 시작") {
        return { status: "대응 시작", color: "#ef4444", targetWindow: w6_12 };
    }
    if (w12_24 && w12_24.status === "대응 시작") {
        return { status: "대응 시작", color: "#ef4444", targetWindow: w12_24 };
    }
    if (w24_72 && w24_72.status === "대응 시작") {
        return { status: "대응 시작", color: "#ef4444", targetWindow: w24_72 };
    }

    return { status: "미대응", color: "#64748b", targetWindow: w24_72 || null };
}

function generateDecisionReason(decisionObj) {
    if (decisionObj.rainStartTimeStr && decisionObj.rainStartTimeStr !== "예측 범위 내 비 없음") {
        return `<span style="display:inline-block; font-size:0.9rem; color:#60a5fa; background:rgba(59,130,246,0.15); padding:6px 16px; border-radius:30px; border: 1px solid rgba(59,130,246,0.3);"><i class="ri-drop-line"></i> 강우 시작 시간: <b>${decisionObj.rainStartTimeStr}</b></span>`;
    }
    return ``;
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
        // 기존 상태 기반 투명 박스 및 큰 테두리 제거 (A영역 큰 네모 제거)
        resultBox.style.backgroundColor = 'transparent';
        resultBox.style.borderColor = 'transparent';
        resultBox.style.padding = '0 0 10px 0';
        resultBox.style.marginBottom = '5px';
        
        // "대응 시작 / 미대응" 큰 상태 글씨 숨김
        statusText.style.display = 'none';
        
        // 이유 영역에 오직 예상 강우 시작 시간만 표출
        reasonText.innerHTML = generateDecisionReason(decisionObj);
        
        let gridHtml = '';
        windows.forEach(w => {
            // ★ 대응 시작 조건이 되면 빨간색으로 하이라이트
            let windowColor = '#64748b'; // 기본 (미대응)
            if (w.status === '대응 시작') windowColor = '#ef4444';
            
            gridHtml += `
                <div style="background: rgba(15,23,42,0.4); border: 1px solid ${windowColor}60; border-left: 3px solid ${windowColor}; padding: 10px; border-radius: 8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; gap: 4px;">
                        <span style="font-size: 0.7rem; color: ${windowColor}; font-weight: 600; white-space: nowrap; letter-spacing: -0.5px;">${w.name.replace('h','시간')} 구간</span>
                        <span style="font-size: 0.75rem; font-weight: 700; color: ${windowColor}; white-space: nowrap;">${w.status}</span>
                    </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.75rem; color: #cbd5e1; white-space: nowrap; letter-spacing: -0.5px;">예상 강수량</span>
                            <span style="font-size: 1.05rem; font-weight: 700;">${w.totalRain.toFixed(1)}<span style="font-size:0.75rem;font-weight:400;color:#94a3b8">mm</span></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.75rem; color: #cbd5e1; white-space: nowrap; letter-spacing: -0.5px;">강수 확률</span>
                            <span style="font-size: 1.05rem; font-weight: 700; color: ${windowColor};">${w.avgProb}<span style="font-size:0.75rem;font-weight:400;color:#94a3b8">%</span></span>
                        </div>
                    </div>
                </div>
            `;
        });
        grid.innerHTML = gridHtml;

        // ★ 최근 5일 강수량 이력을 그리드 하단에 추가 (전역 변수에 저장된 값 사용)
        let historySection = document.getElementById('decisionRecentRains');
        if (!historySection) {
            historySection = document.createElement('div');
            historySection.id = 'decisionRecentRains';
            historySection.style.marginTop = '15px';
            historySection.style.paddingTop = '15px';
            historySection.style.borderTop = '1px solid rgba(255,255,255,0.1)';
            document.getElementById('decisionContent').appendChild(historySection);
        }

        if (window.globalRecentRains && window.globalRecentRains.length > 0) {
            let histHtml = `<div style="font-size:0.75rem; color:#94a3b8; margin-bottom:8px;">최근 5회 강수 이력 (유효강우 ≥ 0.5mm)</div>`;
            window.globalRecentRains.forEach(r => {
                const barWidth = Math.min(r.amount / 50 * 100, 100);
                const dateFormatted = r.date.substring(5).replace('-', '/');
                histHtml += `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:0.8rem;">
                        <span style="width:50px; color:#cbd5e1; flex-shrink:0;">${dateFormatted}</span>
                        <div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                            <div style="width:${barWidth}%; height:100%; background:linear-gradient(90deg,#3b82f6,#60a5fa); border-radius:3px;"></div>
                        </div>
                        <span style="width:55px; text-align:right; font-weight:600; flex-shrink:0; color:#e2e8f0;">${r.amount.toFixed(1)}<span style="font-size:0.7rem; color:#94a3b8;">mm</span></span>
                    </div>`;
            });
            historySection.innerHTML = histHtml;
            historySection.style.display = 'block';
        } else {
            historySection.style.display = 'none';
        }
    }
}
window.renderMonitoringCard = function(data, currentIndex) {
    const card = document.getElementById('monitoringCard');
    if (!card) return;
    
    if (!data || !data.hourly || !data.hourly.time) return;
    const timeArr = data.hourly.time;
    const len = timeArr.length;
    let rainArr = [];
    for (let i=0; i<len; i++) {
        let r = 0;
        if (data.hourly.precipitation_kma && data.hourly.precipitation_kma[i] !== undefined) r = data.hourly.precipitation_kma[i];
        else if (data.hourly.precipitation_om && data.hourly.precipitation_om[i] !== undefined) r = data.hourly.precipitation_om[i];
        else if (data.hourly.precipitation_best_match && data.hourly.precipitation_best_match[i] !== undefined) r = data.hourly.precipitation_best_match[i];
        else if (data.hourly.precipitation && data.hourly.precipitation[i] !== undefined) r = data.hourly.precipitation[i];
        rainArr.push(r);
    }
    
    let targetStartIdx = -1;
    for(let i = currentIndex; i < Math.min(len, currentIndex + 72); i++) {
        if (rainArr[i] >= 0.1) {
            targetStartIdx = i;
            break;
        }
    }
    
    const infoBox = document.getElementById('monEventInfo');
    
    if (targetStartIdx === -1) {
        card.style.display = 'block';
        document.getElementById('monTotalRain').innerText = "0.0";
        document.getElementById('monCumRain').innerText = "0.0";
        document.getElementById('monAvgInt').innerText = "0.0";
        
        infoBox.innerHTML = `<i class="ri-cloud-windy-line"></i> 예측 범위 내 단일 강우 이벤트가 없습니다.`;
        infoBox.style.borderLeftColor = "#64748b";
        infoBox.style.background = "rgba(255,255,255,0.05)";
        infoBox.style.color = "#94a3b8";
        return;
    }
    
    let eventStartIdx = targetStartIdx;
    let consecutiveZeros = 0;
    for(let i = targetStartIdx - 1; i >= 0; i--) {
        if (rainArr[i] < 0.1) {
            consecutiveZeros++;
            if (consecutiveZeros >= 6) break;
        } else {
            consecutiveZeros = 0;
            eventStartIdx = i;
        }
    }
    
    let eventEndIdx = targetStartIdx;
    consecutiveZeros = 0;
    for(let i = targetStartIdx + 1; i < len; i++) {
        if (rainArr[i] < 0.1) {
            consecutiveZeros++;
            if (consecutiveZeros >= 6) break;
        } else {
            consecutiveZeros = 0;
            eventEndIdx = i;
        }
    }
    
    // 의사결정 카드와 동일 기준: 현재 시간 제외, 미래 72시간(offset 1~72)의 KMA 데이터만 합산
    let expectedTotal = 0;
    for(let i = currentIndex + 1; i <= Math.min(currentIndex + 72, len - 1); i++) {
        expectedTotal += rainArr[i];
    }
    
    let cumulativeNow = 0;
    if (eventStartIdx <= currentIndex) {
        for(let i = eventStartIdx; i <= currentIndex; i++) {
            cumulativeNow += rainArr[i];
        }
    }
    
    let durationHours = (eventEndIdx - eventStartIdx) + 1;
    let avgIntensity = durationHours > 0 ? expectedTotal / durationHours : 0;
    
    card.style.display = 'block';
    document.getElementById('monTotalRain').innerText = expectedTotal.toFixed(1);
    document.getElementById('monCumRain').innerText = cumulativeNow.toFixed(1);
    document.getElementById('monAvgInt').innerText = avgIntensity.toFixed(1);
    
    let startDateStr = timeArr[eventStartIdx].substring(5, 16).replace('-', '/').replace('T', ' ');
    let endDateStr = timeArr[eventEndIdx].substring(5, 16).replace('-', '/').replace('T', ' ');
    
    let infoHtml = `이벤트 구간: <b>${startDateStr}</b> ~ <b>${endDateStr}</b> <span style="margin-left:4px; opacity:0.8;">(총 ${durationHours}시간)</span>`;
    
    if (eventStartIdx <= currentIndex && currentIndex <= eventEndIdx) {
        infoHtml = `<span style="color:#ef4444; font-weight:700;"><i class="ri-pulse-line"></i> 진행 중</span> <span style="margin:0 6px; color:rgba(255,255,255,0.2);">|</span> ` + infoHtml;
        infoBox.style.borderLeftColor = "#ef4444";
        infoBox.style.background = "rgba(239,68,68,0.08)";
        infoBox.style.color = "#cbd5e1";
    } else {
        infoHtml = `<span style="color:#3b82f6; font-weight:700;"><i class="ri-time-line"></i> 다가오는 이벤트</span> <span style="margin:0 6px; color:rgba(255,255,255,0.2);">|</span> ` + infoHtml;
        infoBox.style.borderLeftColor = "#3b82f6";
        infoBox.style.background = "rgba(59,130,246,0.08)";
        infoBox.style.color = "#cbd5e1";
    }
    infoBox.innerHTML = infoHtml;
};

function runDecisionLogic(allHourlyData, data, currentIndex) {
    let windows = calculateAllWindowScores(allHourlyData);
    let decision = determineFinalDecision(windows, allHourlyData);
    
    decision.rainStartTimeStr = "예측 범위 내 비 없음";
    
    if (data && currentIndex !== undefined) {
        let len = data.hourly.time.length;
        let rainArr = [];
        for (let i=0; i<len; i++) {
            let r = 0;
            if (data.hourly.precipitation_kma && data.hourly.precipitation_kma[i] !== undefined) r = data.hourly.precipitation_kma[i];
            else if (data.hourly.precipitation_om && data.hourly.precipitation_om[i] !== undefined) r = data.hourly.precipitation_om[i];
            else if (data.hourly.precipitation && data.hourly.precipitation[i] !== undefined) r = data.hourly.precipitation[i];
            rainArr.push(r);
        }
        
        let targetStartIdx = -1;
        for(let i = currentIndex; i < Math.min(len, currentIndex + 72); i++) {
            if (rainArr[i] >= 0.1) {
                targetStartIdx = i;
                break;
            }
        }
        
        if (targetStartIdx !== -1) {
            let eventStartIdx = targetStartIdx;
            let consecutiveZeros = 0;
            for(let i = targetStartIdx - 1; i >= 0; i--) {
                if (rainArr[i] < 0.1) {
                    consecutiveZeros++;
                    if (consecutiveZeros >= 6) break;
                } else {
                    consecutiveZeros = 0;
                    eventStartIdx = i;
                }
            }
            
            let startTimeStrRaw = data.hourly.time[eventStartIdx];
            let dDate = new Date(startTimeStrRaw);
            let M = dDate.getMonth() + 1;
            let d = dDate.getDate();
            let h = dDate.getHours();
            decision.rainStartTimeStr = `${M}/${d} ${h}시 (${rainArr[eventStartIdx].toFixed(1)}mm)`;
        }
    }

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

// 연관 필터링 사이트 검색 기능
document.getElementById('siteSearchInput')?.addEventListener('input', function(e) {
    const query = e.target.value.toLowerCase();
    const links = document.querySelectorAll('.site-link');
    links.forEach(link => {
        const name = link.getAttribute('data-name').toLowerCase();
        if (name.includes(query)) {
            link.style.display = 'flex';
        } else {
            link.style.display = 'none';
        }
    });
});

// 검색 도움말 및 주소 검색 필드 보강
const addrSearch = document.getElementById('addressSearch');
if (addrSearch) {
    addrSearch.placeholder = "장소, 주소 검색 (예: 한강대교, 성수동 등)";
}

// =========================================================
// ★ 환경부 수질측정망(하천) 레이어 — MarkerCluster 연동
// =========================================================
let wqClusterGroup = null;
let wqLayerLoaded = false;

const regionColors = {
    '한강': '#3b82f6', '낙동강': '#ef4444', '금강': '#f59e0b',
    '영산강': '#10b981', '섬진강': '#8b5cf6', '제주': '#06b6d4', '동해': '#0ea5e9', '서해': '#64748b'
};

function getRegionColor(region) {
    for (const [key, color] of Object.entries(regionColors)) {
        if (region && region.includes(key)) return color;
    }
    return '#94a3b8';
}

function createWqIcon(color) {
    return L.divIcon({
        className: 'wq-station-icon',
        html: `<div style="width:13px;height:13px;background:${color};border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [13, 13], iconAnchor: [6, 6], popupAnchor: [0, -10]
    });
}

window.fetchWaterQualityAPI = async function(stn_cd) {
    const apiKey = 'Bclip8wR9Tcgz%2FjPEcTpnhuAyyrGeu6kW0vTxi1ItGQMKH7OTLdAgYwQZvF1qu3BZSN2bBo6G2Dg7Gl3%2FX4qoQ%3D%3D';
    const url = `http://apis.data.go.kr/1480523/WaterQualityService/getWaterMeasuringList?serviceKey=${apiKey}&numOfRows=1000&pageNo=1&ptNoList=${stn_cd}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('API 네트워크 오류');
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "application/xml");
        
        const items = xml.querySelectorAll('item');
        if (items.length === 0) return null;

        let latestItem = null;
        let maxDate = '';
        
        items.forEach(item => {
            const dateNode = item.querySelector('wmcymd');
            if (dateNode) {
                const dateVal = dateNode.textContent;
                if (dateVal > maxDate) {
                    maxDate = dateVal;
                    latestItem = item;
                }
            }
        });

        if (!latestItem) return null;
        
        const getValue = (nodeName) => {
            const n = latestItem.querySelector(nodeName);
            return (n && n.textContent && n.textContent.trim() !== '') ? n.textContent.trim() : '-';
        };

        return {
            date: maxDate,
            toc: getValue('itemToc'),
            ss: getValue('itemSs'),
            tp: getValue('itemTp')
        };
    } catch(e) {
        console.error("Water Quality API Error:", e);
        return null;
    }
};

function buildWqPopup(props) {
    const nm = props.stn_nm || '(미상)';
    const cd = props.stn_cd || '';
    const rg = props.region || '';
    
    // GeoJSON 자체에 해당 속성이 없어서 파이썬 변환 시 깨졌던 기본값들을 복구 및 보정
    let ws = props.watershed || '';
    if (ws.includes('?')) {
        // 측정소 코드 첫자리로 수계 추론 (1:한강, 2:낙동강, 3:금강, 4/5:영산강/섬진강)
        const prefix = cd.charAt(0);
        const wsMap = { '1': '한강', '2': '낙동강', '3': '금강', '4': '섬진강', '5': '영산강', '6': '제주/기타' };
        ws = wsMap[prefix] || '-';
    }
    
    let mr = props.mid_region || '';
    if (mr.includes('?')) mr = '- (정보 없음)';
    
    let st = props.stream_type || '';
    if (st.includes('?')) st = '하천';
    
    let sl = props.sample_loc || '';
    if (sl.includes('?')) sl = '-';
    
    let ag = props.agency || '';
    if (ag.includes('?')) ag = '환경부/지자체';

    const yr = props.install_yr || '';
    const co = getRegionColor(rg);
    const stMap = { '본': '본류', '지': '지류', '동해': '동해유입', '서해': '서해유입', '제주': '제주' };
    const stLabel = stMap[st] || st || '-';
    const waterUrl = `https://water.nier.go.kr/web/waterMeasure?pMsrStCd=${encodeURIComponent(cd)}`;
    return `<div style="min-width:240px;font-family:'Pretendard',sans-serif;background:#fff;color:#1e293b;padding:12px;border-radius:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${co};flex-shrink:0;"></div>
            <div><div style="font-size:1.0rem;font-weight:700;color:#0f172a;">${nm}</div>
            <div style="font-size:0.72rem;color:#64748b;font-family:monospace;">${cd}</div></div>
            <div style="margin-left:auto;background:${co}22;color:${co};font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:10px;">${rg}</div>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:5px 0;">
        <table style="font-size:0.77rem;color:#334155;width:100%;border-collapse:collapse;">
            <tr><td style="padding:2px 0;color:#64748b;width:60px;">수계</td><td style="font-weight:500;color:#1e293b;">${ws}</td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">중권역</td><td style="font-weight:500;color:#1e293b;font-size:0.72rem;">${mr}</td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">본/지류</td><td><span style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:0.7rem;color:#334155;">${stLabel}</span></td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">조사기관</td><td style="font-size:0.73rem;color:#1e293b;">${ag}</td></tr>
        </table>
        
        <div id="wqAPI_${cd}" style="margin-top:8px; padding:8px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0; font-size:0.75rem;">
            <div style="text-align:center; color:#94a3b8; font-style:italic;">데이터 대기 중...</div>
        </div>

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:5px 0;">
        <a href="${waterUrl}" target="_blank" rel="noopener noreferrer"
           style="display:flex;align-items:center;justify-content:center;gap:4px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;padding:7px;border-radius:8px;text-decoration:none;font-size:0.78rem;font-weight:600;">
            <i class="ri-external-link-line"></i> 물환경정보시스템 수질자료 조회
        </a>
        <div style="font-size:0.62rem;color:#94a3b8;margin-top:5px;text-align:right;">※ 환경부 국립환경과학원 수질측정망</div>
    </div>`;
}

async function loadWaterQualityStations() {
    if (wqLayerLoaded) return;
    const countEl = document.getElementById('wqStationCount');
    if (countEl) countEl.textContent = '데이터 로딩 중...';

    try {
        if (typeof WQ_STATIONS_DATA === 'undefined') throw new Error('수질측정망 데이터 미로딩');
        const geojson = WQ_STATIONS_DATA;

        wqClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 45, spiderfyOnMaxZoom: true,
            showCoverageOnHover: false, zoomToBoundsOnClick: true,
            iconCreateFunction: function(cluster) {
                const c = cluster.getChildCount();
                const d = c > 50 ? 50 : (c > 20 ? 42 : 36);
                return L.divIcon({
                    html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:rgba(52,211,153,0.85);border:3px solid rgba(255,255,255,0.9);box-shadow:0 2px 10px rgba(16,185,129,0.4);display:flex;align-items:center;justify-content:center;font-size:${c > 50 ? 14 : 12}px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.2);">${c}</div>`,
                    className: 'wq-cluster-icon', iconSize: [d, d]
                });
            }
        });

        let count = 0;
        geojson.features.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'Point') return;
            const co = f.geometry.coordinates;
            const p = f.properties;
            const marker = L.marker([co[1], co[0]], { icon: createWqIcon(getRegionColor(p.region)) });
            marker.bindPopup(buildWqPopup(p), { maxWidth: 320 });
            marker.bindTooltip(`<b>${p.stn_nm || ''}</b><br><span style="font-size:0.75rem;color:#64748b;">${p.stn_cd || ''} · ${p.region || ''}</span>`, {
                direction: 'top', offset: [0, -10]
            });
            
            marker.on('popupopen', async () => {
                const apiContainer = document.getElementById(`wqAPI_${p.stn_cd}`);
                if (!apiContainer) return;
                
                if (marker._wqDataLoaded) return;
                
                apiContainer.innerHTML = `<div style="text-align:center; color:#3b82f6; padding:4px;"><i class="ri-loader-4-line ri-spin" style="font-size:1.1rem; display:inline-block; vertical-align:-2px; margin-right:4px;"></i> API 데이터 가져오는 중...</div>`;
                
                const data = await window.fetchWaterQualityAPI(p.stn_cd);
                marker._wqDataLoaded = true;

                if (!data) {
                    apiContainer.innerHTML = `<div style="text-align:center; color:#f43f5e; padding:4px; font-weight:600;"><i class="ri-error-warning-line"></i> 최근 측정 데이터를 찾을 수 없습니다.</div>`;
                } else {
                    apiContainer.innerHTML = `
                        <div style="font-weight:700; color:#0f172a; margin-bottom:8px; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                            <span>최근 관측 수치</span>
                            <span style="font-size:0.65rem; color:#64748b; font-weight:400; background:#e2e8f0; padding:2px 6px; border-radius:4px;"><i class="ri-calendar-line"></i> ${data.date}</span>
                        </div>
                        <table style="width:100%; border-collapse:collapse; text-align:center; font-size:0.75rem; background:#fff;">
                            <tr style="background:#f1f5f9; color:#475569; font-weight:600;">
                                <td style="padding:4px; border:1px solid #cbd5e1; border-radius:4px 0 0 0;">TOC</td>
                                <td style="padding:4px; border:1px solid #cbd5e1;">SS</td>
                                <td style="padding:4px; border:1px solid #cbd5e1; border-radius:0 4px 0 0;">T-P</td>
                            </tr>
                            <tr style="color:#334155;">
                                <td style="padding:4px; border:1px solid #cbd5e1;"><b style="color:#0ea5e9; font-size:0.9rem;">${data.toc}</b> <span style="font-size:0.6rem;">mg/L</span></td>
                                <td style="padding:4px; border:1px solid #cbd5e1;"><b style="color:#8b5cf6; font-size:0.9rem;">${data.ss}</b> <span style="font-size:0.6rem;">mg/L</span></td>
                                <td style="padding:4px; border:1px solid #cbd5e1;"><b style="color:#ec4899; font-size:0.9rem;">${data.tp}</b> <span style="font-size:0.6rem;">mg/L</span></td>
                            </tr>
                        </table>
                    `;
                }
            });

            wqClusterGroup.addLayer(marker);
            count++;
        });

        wqLayerLoaded = true;
        if (countEl) countEl.textContent = `전국 ${count}개 측정소 로딩 완료`;
        if (document.getElementById('layerWaterQuality')?.checked) map.addLayer(wqClusterGroup);
    } catch (e) {
        console.error('[수질측정망] 로딩 실패:', e);
        const el = document.getElementById('wqStationCount');
        if (el) el.textContent = '⚠️ 데이터 로딩 실패';
    }
}

document.getElementById('layerWaterQuality')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
        if (!wqLayerLoaded) await loadWaterQualityStations();
        if (wqClusterGroup) map.addLayer(wqClusterGroup);
    } else {
        if (wqClusterGroup) map.removeLayer(wqClusterGroup);
    }
});

// ==========================================
// ★ 즐겨찾기 (Favorites) 기능
// ==========================================
const FAV_KEY = 'app_favorites';

function getFavorites() {
    try {
        const favs = localStorage.getItem(FAV_KEY);
        return favs ? JSON.parse(favs) : [];
    } catch(e) { return []; }
}

function saveFavorites(favs) {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    renderFavoritesList();
}

function isFavorite(lat, lng) {
    const favs = getFavorites();
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    return favs.some(f => f.key === key);
}

window.togglePointFavorite = function(lat, lng) {
    let favs = getFavorites();
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const idx = favs.findIndex(f => f.key === key);
    if (idx >= 0) {
        favs.splice(idx, 1);
    } else {
        const name = prompt('즐겨찾기 지점의 이름을 입력하세요:', `지점 (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
        if (name === null) return;
        favs.push({ key, lat, lng, name: name || `지점 (${lat.toFixed(3)}, ${lng.toFixed(3)})`, timestamp: Date.now() });
    }
    saveFavorites(favs);
    
    // 팝업 내 즐겨찾기 아이콘 즉시 업데이트
    const btn = document.getElementById(`favBtn_${key}`);
    if (btn) {
        btn.innerHTML = (idx < 0) ? '<i class="ri-star-fill" style="color:#facc15;"></i>' : '<i class="ri-star-line" style="color:#cbd5e1;"></i>';
    }
};

window.goToFavorite = function(lat, lng) {
    map.flyTo([lat, lng], 13, { duration: 1.5 });
    setTimeout(() => { map.fireEvent('click', { latlng: L.latLng(lat, lng) }); }, 1600);
};

function renderFavoritesList() {
    const listEl = document.getElementById('favoritesList');
    if (!listEl) return;
    
    const favs = getFavorites();
    if (favs.length === 0) {
        listEl.innerHTML = '<li style="text-align:center; color:#64748b; padding:10px; font-size:0.8rem;">저장된 지점이 없습니다.<br><span style="font-size:0.72rem;">지도 클릭 후 팝업의 ★으로 저장</span></li>';
        return;
    }
    
    favs.sort((a, b) => b.timestamp - a.timestamp);
    
    let html = '';
    favs.forEach(f => {
        html += `
            <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px; transition:0.2s;">
                <div style="flex:1; cursor:pointer;" onclick="goToFavorite(${f.lat}, ${f.lng})" onmouseover="this.querySelector('.fav-nm').style.color='#60a5fa'" onmouseout="this.querySelector('.fav-nm').style.color='#e2e8f0'">
                    <div class="fav-nm" style="color:#e2e8f0; font-weight:600; font-size:0.83rem; transition:0.2s;"><i class="ri-map-pin-2-fill" style="color:#facc15; margin-right:4px;"></i>${f.name}</div>
                    <div style="color:#64748b; font-size:0.68rem; margin-top:1px;">위도: ${f.lat.toFixed(4)}, 경도: ${f.lng.toFixed(4)}</div>
                </div>
                <button onclick="togglePointFavorite(${f.lat}, ${f.lng})" style="background:none; border:none; cursor:pointer; font-size:1.1rem; color:#facc15; padding:4px;" title="즐겨찾기 해제">
                    <i class="ri-star-fill"></i>
                </button>
            </li>
        `;
    });
    listEl.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => { setTimeout(renderFavoritesList, 100); });

// ==========================================
// ★ 전국 수위관측소 (HRFCO) 실시간 데이터
// ==========================================
let wlLayerLoaded = false;
let wlClusterGroup = null;
const HRFCO_API_KEY = 'CAADEBD2-8F00-4ADB-9ED5-7D4ECDEF3F7C';

function parseDmsToDec(dmsStr) {
    if (!dmsStr) return null;
    const cleanStr = dmsStr.trim();
    if (cleanStr === "" || cleanStr === "--" || cleanStr.indexOf('-') === -1) return null;
    const parts = cleanStr.split('-');
    if (parts.length < 3) return null;
    const d = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (isNaN(d) || isNaN(m) || isNaN(s)) return null;
    return d + (m / 60) + (s / 3600);
}

function createWlIcon() {
    return L.divIcon({
        className: 'wl-station-icon',
        html: `<div style="width:16px;height:16px;background:#3b82f6;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;">🌊</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -11]
    });
}

function buildWlPopup(props) {
    const nm = props.obsnm || '(이름없음)';
    const cd = props.wlobscd || '';
    const attwl = parseFloat(props.attwl) || 0; // 관심수위
    const wrnwl = parseFloat(props.wrnwl) || 0; // 주의보수위
    const wl = parseFloat(props.wl);
    const fw = parseFloat(props.fw);
    const gdt = parseFloat(props.gdt) || 0; // 영점표고
    
    let wlStr = isNaN(wl) ? '-' : wl.toFixed(2);
    let fwStr = isNaN(fw) ? '-' : fw.toFixed(2);
    let elWlStr = isNaN(wl) ? '-' : (wl + gdt).toFixed(2);
    
    let status = '정상';
    let statusColor = '#10b981';
    if (attwl > 0 && wl >= attwl) { status = '관심'; statusColor = '#facc15'; }
    if (wrnwl > 0 && wl >= wrnwl) { status = '주의보'; statusColor = '#f97316'; }

    return `<div style="min-width:220px;font-family:'Pretendard',sans-serif;background:#fff;color:#1e293b;padding:12px;border-radius:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;flex-shrink:0;"></div>
            <div>
                <div style="font-size:1.05rem;font-weight:700;color:#0f172a;">${nm}</div>
                <div style="font-size:0.72rem;color:#64748b;font-family:monospace;">${cd}</div>
            </div>
            <div style="margin-left:auto;background:${statusColor}33;color:${statusColor === '#facc15' ? '#d97706' : statusColor};font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:10px;">${status}</div>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:5px 0;">
        <table style="font-size:0.8rem;color:#334155;width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 0;color:#64748b;width:75px;">해발수위</td><td style="font-weight:700;color:#2563eb;font-size:1.1rem;text-align:right;">${elWlStr} <span style="font-size:0.75rem;color:#64748b;font-weight:500;">EL.m</span></td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">관측수위</td><td style="font-weight:500;text-align:right;font-size:0.85rem;">${wlStr} <span style="font-size:0.7rem;color:#94a3b8;">m</span> <span style="font-size:0.6rem;color:#cbd5e1;">(영점: ${gdt.toFixed(2)}m)</span></td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">하천유량</td><td style="font-weight:500;text-align:right;font-size:0.85rem;">${fwStr} <span style="font-size:0.7rem;color:#94a3b8;">m³/s</span></td></tr>
            <tr><td style="padding:2px 0;color:#64748b;">관심/주의</td><td style="font-size:0.75rem;text-align:right;">${attwl > 0 ? attwl : '-'} / ${wrnwl > 0 ? wrnwl : '-'} m</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:5px 0;">
        <div style="font-size:0.65rem;color:#94a3b8;margin-top:5px;text-align:right;">※ 한강홍수통제소 실시간 데이터</div>
    </div>`;
}

async function loadWaterLevelStations(forceRefresh = false) {
    if (wlLayerLoaded && !forceRefresh) return;
    const countEl = document.getElementById('wlStationCount');
    if (countEl) countEl.innerHTML = '데이터 로딩 중... <i class="ri-loader-4-line" style="animation:spin 1s linear infinite; display:inline-block;"></i>';

    try {
        const infoUrl = `https://api.hrfco.go.kr/${HRFCO_API_KEY}/waterlevel/info.json`;
        const listUrl = `https://api.hrfco.go.kr/${HRFCO_API_KEY}/waterlevel/list.json`;

        const [infoRes, listRes] = await Promise.all([ fetch(infoUrl), fetch(listUrl) ]);
        if (!infoRes.ok || !listRes.ok) throw new Error('HRFCO API HTTP 에러');
        
        const infoData = await infoRes.json();
        const listData = await listRes.json();

        const wlMap = {};
        if (listData.content) {
            listData.content.forEach(item => {
                wlMap[item.wlobscd] = {
                    wl: item.wl,
                    fw: item.fw,
                    ymdhm: item.ymdhm
                };
            });
        }

        if (!wlClusterGroup) {
            wlClusterGroup = L.markerClusterGroup({
                maxClusterRadius: 50, spiderfyOnMaxZoom: true,
                showCoverageOnHover: false, zoomToBoundsOnClick: true,
                iconCreateFunction: function(cluster) {
                    const c = cluster.getChildCount();
                    const d = c > 50 ? 50 : (c > 20 ? 42 : 36);
                    return L.divIcon({
                        html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:rgba(59,130,246,0.85);border:3px solid rgba(255,255,255,0.9);box-shadow:0 2px 10px rgba(59,130,246,0.4);display:flex;align-items:center;justify-content:center;font-size:${c > 50 ? 14 : 12}px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.2);">${c}</div>`,
                        className: 'wl-cluster-icon', iconSize: [d, d]
                    });
                }
            });
        } else {
            wlClusterGroup.clearLayers(); // 갱신 시 기존 마커 삭제
        }

        let count = 0;
        if (infoData.content) {
            infoData.content.forEach(p => {
                const latDec = parseDmsToDec(p.lat);
                const lonDec = parseDmsToDec(p.lon);
                
                if (latDec && lonDec) {
                    const currentData = wlMap[p.wlobscd] || {};
                    const mergedProps = { ...p, ...currentData };
                    
                    const marker = L.marker([latDec, lonDec], { icon: createWlIcon() });
                    marker.bindPopup(buildWlPopup(mergedProps), { maxWidth: 300 });
                    wlClusterGroup.addLayer(marker);
                    count++;
                }
            });
        }

        if (document.getElementById('layerWaterLevel').checked) {
            map.addLayer(wlClusterGroup);
        }
        wlLayerLoaded = true;
        const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        if (countEl) countEl.innerHTML = `<span style="color:#10b981;">●</span> 전국 ${count}개소 실시간 연동 (갱신: ${nowStr})`;
        
    } catch(e) {
        console.error('HRFCO API 로딩 에러:', e);
        if (countEl) countEl.innerHTML = `<span style="color:#f43f5e;">⚠️ 연동 실패</span>`;
        document.getElementById('layerWaterLevel').checked = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const wlCheck = document.getElementById('layerWaterLevel');
    if (wlCheck) {
        wlCheck.addEventListener('change', function() {
            if (this.checked) {
                if (!wlLayerLoaded) {
                    loadWaterLevelStations();
                } else if (wlClusterGroup) {
                    map.addLayer(wlClusterGroup);
                }
            } else {
                if (wlClusterGroup && map.hasLayer(wlClusterGroup)) {
                    map.removeLayer(wlClusterGroup);
                }
            }
        });
    }

    // 1시간(3,600,000ms) 간격으로 수위선 관측소 데이터 자동 갱신
    setInterval(() => {
        if (wlLayerLoaded && document.getElementById('layerWaterLevel') && document.getElementById('layerWaterLevel').checked) {
            console.log('수위관측소 데이터 1시간 주기 자동 갱신');
            loadWaterLevelStations(true);
        }
    }, 3600000);
});

// ==========================================
// ★ 한국 기상청(KMA) 초단기실황 데이터 조회 모듈
// ==========================================
function dfs_xy_conv(code, v1, v2) {
    const RE = 6371.00877; // 지구 반경(km)
    const GRID = 5.0;      // 격자 간격(km)
    const SLAT1 = 30.0;    // 투영 위도1(degree)
    const SLAT2 = 60.0;    // 투영 위도2(degree)
    const OLON = 126.0;    // 기준점 경도(degree)
    const OLAT = 38.0;     // 기준점 위도(degree)
    const XO = 43;         // 기준점 X좌표(GRID)
    const YO = 136;        // 기준점 Y좌표(GRID)
    
    const DEGRAD = Math.PI / 180.0;
    
    const re = RE / GRID;
    const slat1 = SLAT1 * DEGRAD;
    const slat2 = SLAT2 * DEGRAD;
    const olon = OLON * DEGRAD;
    const olat = OLAT * DEGRAD;
    
    let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
    let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = re * sf / Math.pow(ro, sn);
    
    let rs = {};
    if (code === "toXY") {
        rs['lat'] = v1;
        rs['lng'] = v2;
        let ra = Math.tan(Math.PI * 0.25 + (v1) * DEGRAD * 0.5);
        ra = re * sf / Math.pow(ra, sn);
        let theta = v2 * DEGRAD - olon;
        if (theta > Math.PI) theta -= 2.0 * Math.PI;
        if (theta < -Math.PI) theta += 2.0 * Math.PI;
        theta *= sn;
        rs['x'] = Math.floor(ra * Math.sin(theta) + XO + 0.5);
        rs['y'] = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
    }
    return rs;
}

// fetchKmaUltraSrtNcst has been merged into updatePointData
