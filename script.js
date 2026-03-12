const searchBtn = document.getElementById('search-btn');
const cityInput = document.getElementById('city-input');
const appBody = document.getElementById('app-body');
const celestialBody = document.getElementById('celestial-body');
const weatherFx = document.getElementById('weather-fx');
const loader = document.getElementById('loader');

let pastChartInst = null;
let futureChartInst = null;
let clockInterval = null; 

const safeGet = (obj, path, fallback = "--") => path.split('.').reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : fallback, obj);

function getWeatherDetails(code) {
    if (code === 0) return { emoji: "☀️", text: "Clear" };
    if (code >= 1 && code <= 3) return { emoji: "⛅", text: "Cloudy" };
    if (code >= 45 && code <= 48) return { emoji: "🌫️", text: "Fog" };
    if (code >= 51 && code <= 67) return { emoji: "🌧️", text: "Rain" };
    if (code >= 71 && code <= 77) return { emoji: "❄️", text: "Snow" };
    if (code >= 95 && code <= 99) return { emoji: "⛈️", text: "Storm" };
    return { emoji: "🌍", text: "Variable" };
}

function getCompassDirection(degree) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(degree / 45) % 8];
}

function formatTime(isoString) {
    if(!isoString) return "--:--";
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setSkyAndTime(code, timeStr, isDay) {
    appBody.className = ""; celestialBody.className = ""; weatherFx.innerHTML = ""; 
    let localHour = 12;
    if (timeStr && timeStr.includes('T')) {
        localHour = parseInt(timeStr.split('T')[1].split(':')[0]);
    }
    const isRaining = code >= 51 && code <= 67;

    if (isRaining) {
        appBody.classList.add('sky-rain');
        for(let i=0; i<60; i++) {
            let drop = document.createElement('div'); drop.classList.add('drop');
            drop.style.left = Math.random() * 100 + 'vw';
            drop.style.animationDuration = (Math.random() * 0.5 + 0.5) + 's';
            weatherFx.appendChild(drop);
        }
    } else if (isDay) {
        if (localHour < 10) { appBody.classList.add('sky-morning'); celestialBody.classList.add('sun-morning'); }
        else if (localHour < 16) { appBody.classList.add('sky-noon'); celestialBody.classList.add('sun-noon'); }
        else { appBody.classList.add('sky-sunset'); celestialBody.classList.add('sun-sunset'); }
    } else {
        appBody.classList.add('sky-night');
        if (code <= 3) celestialBody.classList.add('moon-night');
    }
}

// Multi-city fetch engine to find locations with similar temperatures
async function loadSimilarCities(targetTemp) {
    const globals = [
        {name: 'London', lat: 51.5, lon: -0.12}, {name: 'New York', lat: 40.71, lon: -74.0},
        {name: 'Tokyo', lat: 35.68, lon: 139.69}, {name: 'Sydney', lat: -33.86, lon: 151.2},
        {name: 'Dubai', lat: 25.2, lon: 55.27}, {name: 'Paris', lat: 48.85, lon: 2.35},
        {name: 'Mumbai', lat: 19.07, lon: 72.87}, {name: 'Singapore', lat: 1.35, lon: 103.8}
    ];
    
    const lats = globals.map(c => c.lat).join(',');
    const lons = globals.map(c => c.lon).join(',');
    
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code&timezone=auto`);
        const data = await res.json();
        
        // Match response array back to city names and calculate temp difference
        let results = globals.map((city, index) => {
            const cur = data[index].current;
            return {
                name: city.name, temp: Math.round(cur.temperature_2m),
                code: cur.weather_code, diff: Math.abs(cur.temperature_2m - targetTemp)
            };
        });

        // Sort by closest temperature and take the top 4
        results.sort((a, b) => a.diff - b.diff);
        const topCities = results.slice(0, 4);

        let html = '';
        topCities.forEach(c => {
            html += `
                <div class="similar-city">
                    <span class="sc-name">${c.name}</span>
                    <span class="sc-temp">${getWeatherDetails(c.code).emoji} ${c.temp}°C</span>
                </div>
            `;
        });
        document.getElementById('similar-cities-container').innerHTML = html;

    } catch (err) {
        document.getElementById('similar-cities-container').innerHTML = "<p>Scanner offline.</p>";
    }
}

function updateLifeIndex(temp, code, isRaining) {
    // Clothing
    let clothes = "Light, breathable cotton is the way to go today.";
    if (temp < 10) clothes = "Heavy layers and a solid winter coat are required.";
    else if (temp < 20) clothes = "A light jacket or comfy hoodie is recommended.";
    document.getElementById('idx-clothes').innerText = clothes;

    // Rides (Scooter logic)
    let rides = "Clear roads ahead, perfect weather for a scooter ride.";
    if (isRaining) rides = "Roads are slick and wet, maybe leave the two-wheeler parked today.";
    else if (code >= 45 && code <= 48) rides = "Heavy fog limits visibility. Ride slowly.";
    else if (temp < 5) rides = "Freezing temperatures make riding risky. Take a cab.";
    document.getElementById('idx-rides').innerText = rides;

    // Activities (Gaming / Gym logic)
    let sports = "Grab your gear and hit the gym, or get an outdoor run in.";
    if (isRaining || temp > 35) sports = "Not ideal outside. Great time to stay indoors and grind some ranked matches.";
    else if (temp < 10) sports = "A bit too chilly for cardio outside. Hit the indoor weights.";
    document.getElementById('idx-sports').innerText = sports;

    // Health
    let health = "Standard weather, maintain your regular routine.";
    if (temp > 30) health = "High heat index. Hydrate heavily and stick to the shade.";
    else if (temp < 15) health = "Dropping temps increase cold risk. Stay warm to protect your immune system.";
    document.getElementById('idx-health').innerText = health;
}

async function fetchWeather(city) {
    if (!city) return;
    try {
        loader.style.display = "block"; 
        document.getElementById('weather-display').style.display = "none";
        document.getElementById('app-footer').style.display = "none";

        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
        const geoData = await geoRes.json();
        if (!geoData.results) { alert("City not found."); loader.style.display = "none"; return; }

        const { latitude: lat, longitude: lon, name } = geoData.results[0];
        document.getElementById('city-name').innerText = name;

        // Links
        document.getElementById('link-time').href = `https://www.timeanddate.com/worldclock/?query=${lat},${lon}`;
        ['wind', 'rain'].href = `https://weather.com/weather/today/l/${lat},${lon}`;
        ['uv', 'aqi'].forEach(id => document.getElementById(`link-${id}`).href = `https://www.iqair.com/air-quality-map?lat=${lat}&lng=${lon}`);

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,apparent_temperature_max,weather_code,uv_index_max,precipitation_sum,sunrise,sunset&past_days=7&forecast_days=7&timezone=auto`;
        const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`;

        const [wRes, aRes] = await Promise.all([fetch(weatherUrl), fetch(aqiUrl)]);
        if (!wRes.ok) throw new Error("API Rejected.");
        
        const wData = await wRes.json();
        const aData = await aRes.json();

        updateUI(wData, aData);
        
        // Fire off the background job to find similar cities globally
        loadSimilarCities(wData.current.temperature_2m);

    } catch (err) {
        console.error("API Error:", err);
        alert(`Error fetching data.`);
    } finally {
        loader.style.display = "none";
    }
}

function updateUI(wData, aData) {
    const cur = wData.current || {};
    const daily = wData.daily || {};
    const details = getWeatherDetails(cur.weather_code);

    // Current
    document.getElementById('main-emoji').innerText = details.emoji;
    document.getElementById('temperature').innerText = Math.round(cur.temperature_2m || 0);
    document.getElementById('description').innerText = details.text;
    document.getElementById('feels-like').innerText = `Feels like ${Math.round(cur.apparent_temperature || 0)}°C`;
    
    // Live Clock
    const cityTz = wData.timezone || "UTC";
    if (clockInterval) clearInterval(clockInterval);
    function tickClock() {
        document.getElementById('local-time-data').innerText = new Date().toLocaleTimeString('en-US', { timeZone: cityTz, hour: '2-digit', minute: '2-digit' });
        document.getElementById('local-time-sub').innerText = cityTz.split('/').pop().replace(/_/g, ' ') + " Time";
    }
    tickClock(); clockInterval = setInterval(tickClock, 1000);

    // Wind & Rain
    const windDir = cur.wind_direction_10m || 0;
    document.getElementById('wind-data').innerText = `${cur.wind_speed_10m || 0} km/h`;
    document.getElementById('compass-arrow').style.transform = `rotate(${windDir}deg)`;
    document.getElementById('wind-dir-text').innerText = getCompassDirection(windDir);
    document.getElementById('wind-sub').innerText = cur.wind_speed_10m > 20 ? "Hold onto your hat!" : "A refreshing breeze.";

    const rainAmount = safeGet(daily, 'precipitation_sum.7', 0);
    document.getElementById('rain-data').innerText = `${rainAmount} mm`;
    document.getElementById('rain-sub').innerText = rainAmount > 2 ? "Keep an umbrella handy." : "Looks perfectly dry.";

    // UV & AQI
    const uvIndex = safeGet(daily, 'uv_index_max.7', "--");
    document.getElementById('uv-data').innerText = uvIndex;
    document.getElementById('uv-sub').innerText = uvIndex > 6 ? "Lather up that sunscreen." : "No need for heavy shades.";

    const aqi = safeGet(aData, 'current.us_aqi', "--");
    document.getElementById('aqi-data').innerText = aqi;
    document.getElementById('aqi-sub').innerText = aqi < 50 ? "Take a deep breath, it's fresh!" : "Air is a bit dusty today.";

    // Sun & Life Index
    document.getElementById('sunrise-data').innerText = formatTime(safeGet(daily, 'sunrise.7', ""));
    document.getElementById('sunset-data').innerText = formatTime(safeGet(daily, 'sunset.7', ""));
    updateLifeIndex(cur.temperature_2m, cur.weather_code, cur.weather_code >= 51 && cur.weather_code <= 67);

    // Theme & Charts
    setSkyAndTime(cur.weather_code, cur.time, cur.is_day);

    const splitData = (start, end) => ({
        times: daily.time.slice(start, end), temps: daily.temperature_2m_max.slice(start, end),
        feels: daily.apparent_temperature_max.slice(start, end), codes: daily.weather_code.slice(start, end)
    });

    renderChart('pastChart', pastChartInst, splitData(0, 7), '#00f2fe');
    renderChart('futureChart', futureChartInst, splitData(7, 14), '#feca57');

    document.getElementById('weather-display').style.display = "flex";
    document.getElementById('app-footer').style.display = "block";
}

function renderChart(canvasId, instance, dataObj, lineColor) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (instance) instance.destroy();

    // The X-Axis now receives a 3-part array: [Date, Emoji, Temperature]
    const multiLabels = dataObj.times.map((dateStr, i) => [
        new Date(dateStr + "T12:00:00").toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }),
        getWeatherDetails(dataObj.codes[i]).emoji,
        Math.round(dataObj.temps[i]) + "°" 
    ]);

    const newInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: multiLabels,
            datasets: [{
                data: dataObj.temps, borderColor: lineColor, backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 3, pointBackgroundColor: '#fff', pointRadius: 4, fill: true, tension: 0.4,
                pointHoverRadius: 8, pointHoverBackgroundColor: lineColor
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: { bottom: 10, top: 20 } },
            scales: {
                y: { display: false }, 
                x: { ticks: { color: '#fff', font: { size: 14, weight: '500' }, padding: 10 }, grid: { display: false }, border: { display: false } }
            },
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    backgroundColor: 'rgba(0,0,0,0.85)', padding: 15, displayColors: false,
                    callbacks: {
                        title: (ctx) => new Date(dataObj.times[ctx[0].dataIndex] + "T12:00:00").toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
                        label: (ctx) => {
                            const i = ctx.dataIndex;
                            return [`Max Temp: ${Math.round(dataObj.temps[i])}°C`, `Feels Like: ${Math.round(dataObj.feels[i])}°C`, `Condition: ${getWeatherDetails(dataObj.codes[i]).text}`];
                        }
                    }
                } 
            }
        }
    });

    if (canvasId === 'pastChart') pastChartInst = newInst; else futureChartInst = newInst;
}

searchBtn.addEventListener('click', () => fetchWeather(cityInput.value));
cityInput.addEventListener('keypress', (e) => { if (e.key === "Enter") searchBtn.click(); });
window.onload = () => fetchWeather("Bengaluru");