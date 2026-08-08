import { jsxs, jsx } from "react/jsx-runtime";
import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { renderToString } from "react-dom/server";
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("React Error Boundary caught an error:", error, errorInfo);
  }
  render() {
    var _a;
    if (this.state.hasError) {
      return /* @__PURE__ */ jsxs("div", { className: "error", "data-testid": "error", children: [
        /* @__PURE__ */ jsx("h2", { className: "error__title", children: "Something went wrong" }),
        /* @__PURE__ */ jsx("p", { className: "error__message", children: "An unexpected error occurred. Please refresh the page and try again." }),
        /* @__PURE__ */ jsxs("details", { style: { marginTop: "1rem", fontSize: "0.875rem" }, children: [
          /* @__PURE__ */ jsx("summary", { children: "Error details" }),
          /* @__PURE__ */ jsx("pre", { style: { marginTop: "0.5rem", padding: "0.5rem", background: "#f5f5f5", borderRadius: "4px" }, children: (_a = this.state.error) == null ? void 0 : _a.toString() })
        ] })
      ] });
    }
    return this.props.children;
  }
}
const SearchForm = ({ onSearch, isLoading }) => {
  const inputRef = useRef(null);
  useEffect(() => {
    const savedLocation = localStorage.getItem("weather-app-location");
    if (savedLocation && inputRef.current) {
      inputRef.current.value = savedLocation;
    } else if (inputRef.current) {
      inputRef.current.value = "London";
    }
  }, []);
  const handleSubmit = useCallback((e) => {
    var _a, _b;
    e.preventDefault();
    const city = (_b = (_a = inputRef.current) == null ? void 0 : _a.value) == null ? void 0 : _b.trim();
    if (!city) {
      return;
    }
    onSearch(city);
  }, [onSearch]);
  return /* @__PURE__ */ jsx("section", { className: "search-section", children: /* @__PURE__ */ jsx("form", { className: "search-form", "data-testid": "search-form", onSubmit: handleSubmit, children: /* @__PURE__ */ jsxs("div", { className: "search-form__group", children: [
    /* @__PURE__ */ jsx("label", { htmlFor: "location-input", className: "sr-only", children: "Enter city name" }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "text",
        id: "location-input",
        className: "search-input",
        placeholder: "Enter city name...",
        "data-testid": "search-input",
        autoComplete: "off",
        ref: inputRef
      }
    ),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "submit",
        className: "search-button",
        "data-testid": "search-button",
        disabled: isLoading,
        children: [
          /* @__PURE__ */ jsx("span", { className: "search-button__text", children: isLoading ? "Loading..." : "Get Weather" }),
          /* @__PURE__ */ jsx("span", { className: "search-button__icon", children: "🌦️" })
        ]
      }
    )
  ] }) }) });
};
const SearchForm$1 = React.memo(SearchForm);
const LoadingState = ({ isVisible }) => {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "loading",
      "data-testid": "loading",
      hidden: !isVisible,
      children: [
        /* @__PURE__ */ jsx("div", { className: "loading__spinner" }),
        /* @__PURE__ */ jsx("p", { children: "Loading weather data..." })
      ]
    }
  );
};
const LoadingState$1 = React.memo(LoadingState);
const ErrorState = ({ isVisible, message }) => {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "error",
      "data-testid": "error",
      hidden: !isVisible,
      children: [
        /* @__PURE__ */ jsx("h2", { className: "error__title", children: "Unable to load weather data" }),
        /* @__PURE__ */ jsx("p", { className: "error__message", children: message || "Please check the city name and try again." })
      ]
    }
  );
};
const ErrorState$1 = React.memo(ErrorState);
class WeatherUtils {
  static getWeatherDescription(weatherCode) {
    const weatherCodes = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Depositing rime fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Dense drizzle",
      56: "Light freezing drizzle",
      57: "Dense freezing drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      66: "Light freezing rain",
      67: "Heavy freezing rain",
      71: "Slight snow fall",
      73: "Moderate snow fall",
      75: "Heavy snow fall",
      77: "Snow grains",
      80: "Slight rain showers",
      81: "Moderate rain showers",
      82: "Violent rain showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with slight hail",
      99: "Thunderstorm with heavy hail"
    };
    return weatherCodes[weatherCode] || "Unknown";
  }
  static getWeatherIcon(weatherCode, isDay = true) {
    if (weatherCode === 0) {
      return isDay ? "☀️" : "🌙";
    } else if (weatherCode <= 3) {
      return isDay ? "⛅" : "☁️";
    } else if (weatherCode <= 48) {
      return "🌫️";
    } else if (weatherCode <= 57 || weatherCode >= 80 && weatherCode <= 82) {
      return "🌧️";
    } else if (weatherCode >= 61 && weatherCode <= 67) {
      return "🌧️";
    } else if (weatherCode >= 71 && weatherCode <= 77) {
      return "❄️";
    } else if (weatherCode >= 85 && weatherCode <= 86) {
      return "🌨️";
    } else if (weatherCode >= 95) {
      return "⛈️";
    }
    return "🌤️";
  }
  static formatTemperature(temp) {
    return `${Math.round(temp)}°C`;
  }
  static formatWindSpeed(speed) {
    return `${Math.round(speed)} km/h`;
  }
  static formatPressure(pressure) {
    return `${Math.round(pressure)} hPa`;
  }
  static formatPercentage(value) {
    return `${Math.round(value)}%`;
  }
  static getWindDirection(degrees) {
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  }
  static formatDate(dateString) {
    const date = new Date(dateString);
    const today = /* @__PURE__ */ new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return date.toLocaleDateString("en-US", { weekday: "long" });
    }
  }
  static formatTime(timeString) {
    const date = new Date(timeString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
  static getConditionClass(weatherCode) {
    if (weatherCode === 0) {
      return "weather-condition-sunny";
    } else if (weatherCode <= 3) {
      return "weather-condition-cloudy";
    } else if (weatherCode >= 51 && weatherCode <= 67 || weatherCode >= 80 && weatherCode <= 82) {
      return "weather-condition-rainy";
    } else if (weatherCode >= 95) {
      return "weather-condition-stormy";
    }
    return "weather-condition-cloudy";
  }
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}
const CurrentWeather = ({ weatherData }) => {
  if (!weatherData) {
    return null;
  }
  const { current, locationName, country } = weatherData;
  return /* @__PURE__ */ jsxs("section", { className: "current-section", children: [
    /* @__PURE__ */ jsx("h2", { className: "section-title", children: "Current Weather" }),
    /* @__PURE__ */ jsx("div", { className: "weather-card", "data-testid": "current-weather", children: /* @__PURE__ */ jsxs("div", { className: "current-weather", children: [
      /* @__PURE__ */ jsxs("h3", { className: "current-weather__location", "data-testid": "current-location", children: [
        locationName,
        country ? `, ${country}` : ""
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "current-weather__main", children: [
        /* @__PURE__ */ jsx("div", { className: "current-weather__icon", "data-testid": "current-icon", children: WeatherUtils.getWeatherIcon(current.weather_code, current.is_day) }),
        /* @__PURE__ */ jsxs("div", { className: "current-weather__temp-group", children: [
          /* @__PURE__ */ jsx("div", { className: "current-weather__temp", "data-testid": "current-temperature", children: WeatherUtils.formatTemperature(current.temperature_2m) }),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: `current-weather__condition ${WeatherUtils.getConditionClass(current.weather_code)}`,
              "data-testid": "current-condition",
              children: WeatherUtils.getWeatherDescription(current.weather_code)
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "current-weather__details", children: [
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Feels like" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "feels-like", children: WeatherUtils.formatTemperature(current.apparent_temperature) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Humidity" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "humidity", children: WeatherUtils.formatPercentage(current.relative_humidity_2m) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Wind Speed" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "wind-speed", children: WeatherUtils.formatWindSpeed(current.wind_speed_10m) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Pressure" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "pressure", children: WeatherUtils.formatPressure(current.pressure_msl) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Cloud Cover" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "cloud-cover", children: WeatherUtils.formatPercentage(current.cloud_cover) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "weather-detail", children: [
          /* @__PURE__ */ jsx("div", { className: "weather-detail__label", children: "Wind Direction" }),
          /* @__PURE__ */ jsx("div", { className: "weather-detail__value", "data-testid": "wind-direction", children: WeatherUtils.getWindDirection(current.wind_direction_10m) })
        ] })
      ] })
    ] }) })
  ] });
};
const CurrentWeather$1 = React.memo(CurrentWeather);
const ForecastItem = ({ daily, index, isActive, onToggle }) => {
  const forecastData = useMemo(() => ({
    dayName: WeatherUtils.formatDate(daily.time[index]),
    weatherCode: daily.weather_code[index],
    high: daily.temperature_2m_max[index],
    low: daily.temperature_2m_min[index]
  }), [daily, index]);
  const condition = useMemo(
    () => WeatherUtils.getWeatherDescription(forecastData.weatherCode),
    [forecastData.weatherCode]
  );
  const icon = useMemo(
    () => WeatherUtils.getWeatherIcon(forecastData.weatherCode),
    [forecastData.weatherCode]
  );
  const handleClick = useCallback(() => {
    onToggle(index);
  }, [onToggle, index]);
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(index);
    }
  }, [onToggle, index]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `forecast-item ${isActive ? "active" : ""}`,
      "data-testid": "forecast-item",
      tabIndex: "0",
      role: "button",
      "aria-label": `View detailed forecast for ${forecastData.dayName}`,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      children: [
        /* @__PURE__ */ jsx("div", { className: "forecast-item__day", children: forecastData.dayName }),
        /* @__PURE__ */ jsx("div", { className: "forecast-item__icon", children: icon }),
        /* @__PURE__ */ jsxs("div", { className: "forecast-item__info", children: [
          /* @__PURE__ */ jsx("div", { className: "forecast-item__condition", children: condition }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-item__temps", "data-testid": "forecast-temps", children: [
            /* @__PURE__ */ jsx("span", { className: "forecast-item__high", "data-testid": "forecast-high", children: WeatherUtils.formatTemperature(forecastData.high) }),
            /* @__PURE__ */ jsx("span", { className: "forecast-item__low", "data-testid": "forecast-low", children: WeatherUtils.formatTemperature(forecastData.low) })
          ] })
        ] }),
        isActive && /* @__PURE__ */ jsxs("div", { className: "forecast-item__details", children: [
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "Sunrise" }),
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__value", children: WeatherUtils.formatTime(daily.sunrise[index]) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "Sunset" }),
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__value", children: WeatherUtils.formatTime(daily.sunset[index]) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "Rain" }),
            /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item__value", children: [
              daily.rain_sum[index].toFixed(1),
              " mm"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "UV Index" }),
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__value", children: daily.uv_index_max[index].toFixed(1) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "Precipitation" }),
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__value", children: WeatherUtils.formatPercentage(daily.precipitation_probability_max[index]) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item", children: [
            /* @__PURE__ */ jsx("div", { className: "forecast-detail-item__label", children: "Temperature" }),
            /* @__PURE__ */ jsxs("div", { className: "forecast-detail-item__value", children: [
              WeatherUtils.formatTemperature(daily.temperature_2m_min[index]),
              " to ",
              WeatherUtils.formatTemperature(daily.temperature_2m_max[index])
            ] })
          ] })
        ] })
      ]
    }
  );
};
const ForecastItem$1 = React.memo(ForecastItem);
const Forecast = ({ weatherData }) => {
  const [activeForecastIndex, setActiveForecastIndex] = useState(null);
  const handleToggleForecast = useCallback((index) => {
    setActiveForecastIndex(
      (currentIndex) => currentIndex === index ? null : index
    );
  }, []);
  useEffect(() => {
    if (activeForecastIndex !== null) {
      setTimeout(() => {
        const activeElement = document.querySelector(".forecast-item.active");
        if (activeElement) {
          activeElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
  }, [activeForecastIndex]);
  if (!weatherData) {
    return null;
  }
  const { daily } = weatherData;
  return /* @__PURE__ */ jsxs("section", { className: "forecast-section", children: [
    /* @__PURE__ */ jsx("h2", { className: "section-title", children: "7-Day Forecast" }),
    /* @__PURE__ */ jsx("div", { className: "forecast", children: /* @__PURE__ */ jsx("div", { className: "forecast__list", "data-testid": "forecast-list", children: daily.time.map((date, index) => /* @__PURE__ */ jsx(
      ForecastItem$1,
      {
        daily,
        index,
        isActive: activeForecastIndex === index,
        onToggle: handleToggleForecast
      },
      date
    )) }) })
  ] });
};
const WeatherContent = ({ isVisible, weatherData }) => {
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "weather-content",
      "data-testid": "weather-content",
      hidden: !isVisible,
      children: /* @__PURE__ */ jsxs("div", { className: "weather-layout", children: [
        /* @__PURE__ */ jsx(CurrentWeather$1, { weatherData }),
        /* @__PURE__ */ jsx(Forecast, { weatherData })
      ] })
    }
  );
};
const WeatherContent$1 = React.memo(WeatherContent);
class WeatherService {
  constructor() {
    this.baseUrl = "https://api.open-meteo.com/v1";
    this.geocodingUrl = "https://geocoding-api.open-meteo.com/v1";
  }
  async geocodeLocation(cityName) {
    try {
      const response = await fetch(
        `${this.geocodingUrl}/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`
      );
      if (!response.ok) {
        throw new Error("Geocoding failed");
      }
      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        throw new Error("Location not found");
      }
      const location = data.results[0];
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name,
        country: location.country
      };
    } catch (error) {
      console.error("Geocoding error:", error);
      throw new Error("Unable to find location. Please check the city name and try again.");
    }
  }
  async getWeatherData(latitude, longitude) {
    try {
      const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        daily: "temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,rain_sum,uv_index_max,precipitation_probability_max",
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,snowfall,showers,rain,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_direction_10m,wind_gusts_10m,wind_speed_10m",
        timezone: "GMT"
      });
      const response = await fetch(`${this.baseUrl}/forecast?${params}`);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Weather API error:", error);
      throw new Error("Unable to fetch weather data. Please try again later.");
    }
  }
  async getWeatherByCity(cityName) {
    try {
      const location = await this.geocodeLocation(cityName);
      const weather = await this.getWeatherData(location.latitude, location.longitude);
      return {
        ...weather,
        locationName: location.name,
        country: location.country
      };
    } catch (error) {
      console.error("Weather service error:", error);
      throw error;
    }
  }
}
const useWeatherData = (initialData = null, initialError = null) => {
  const [weatherData, setWeatherData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [weatherService] = useState(() => new WeatherService());
  const loadWeather = useCallback(async (city) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await weatherService.getWeatherByCity(city);
      setWeatherData(data);
      try {
        localStorage.setItem("weather-app-location", city);
      } catch (error2) {
        console.warn("Could not save location to localStorage:", error2);
      }
    } catch (error2) {
      setError(error2.message);
    } finally {
      setIsLoading(false);
    }
  }, [weatherService]);
  const getCurrentLocationWeather = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            setIsLoading(true);
            setError(null);
            const { latitude, longitude } = position.coords;
            const data = await weatherService.getWeatherData(latitude, longitude);
            data.locationName = "Current Location";
            setWeatherData(data);
            resolve();
          } catch (error2) {
            setError(error2.message);
            reject(error2);
          } finally {
            setIsLoading(false);
          }
        },
        (error2) => {
          reject(error2);
        },
        {
          timeout: 1e4,
          enableHighAccuracy: false,
          maximumAge: 3e5
          // 5 minutes
        }
      );
    });
  }, [weatherService]);
  const loadSavedLocation = useCallback(async () => {
    try {
      const savedLocation = localStorage.getItem("weather-app-location");
      if (savedLocation) {
        await loadWeather(savedLocation);
        return savedLocation;
      }
    } catch (error2) {
      console.warn("Could not load saved location:", error2);
    }
    if (weatherService.useMockData) {
      await loadWeather("London");
      return "London";
    }
    try {
      await getCurrentLocationWeather();
      return "Current Location";
    } catch (error2) {
      console.warn("Could not get current location:", error2);
      await loadWeather("London");
      return "London";
    }
  }, [loadWeather, getCurrentLocationWeather, weatherService]);
  useEffect(() => {
    if (initialData || initialError) {
      return;
    }
    const autoLoad = async () => {
      try {
        await loadSavedLocation();
      } catch (error2) {
        console.error("Failed to auto-load weather:", error2);
      }
    };
    autoLoad();
  }, [loadSavedLocation]);
  return {
    weatherData,
    isLoading,
    error,
    loadWeather,
    loadSavedLocation,
    getCurrentLocationWeather
  };
};
function App({ initialData = null, initialError = null }) {
  const { weatherData, isLoading, error, loadWeather } = useWeatherData(initialData, initialError);
  const handleSearch = async (city) => {
    await loadWeather(city);
  };
  return /* @__PURE__ */ jsxs(ErrorBoundary, { children: [
    /* @__PURE__ */ jsx("header", { className: "header", children: /* @__PURE__ */ jsx("div", { className: "container", children: /* @__PURE__ */ jsx("h1", { className: "header__title", children: "Weather Front" }) }) }),
    /* @__PURE__ */ jsx("main", { className: "main", children: /* @__PURE__ */ jsxs("div", { className: "container", children: [
      /* @__PURE__ */ jsx(
        SearchForm$1,
        {
          onSearch: handleSearch,
          isLoading
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "weather-container", "data-testid": "weather-container", children: [
        /* @__PURE__ */ jsx(LoadingState$1, { isVisible: isLoading }),
        /* @__PURE__ */ jsx(ErrorState$1, { isVisible: !!error && !isLoading, message: error }),
        /* @__PURE__ */ jsx(WeatherContent$1, { isVisible: !!weatherData && !isLoading && !error, weatherData })
      ] })
    ] }) }),
    /* @__PURE__ */ jsx("footer", { className: "footer", children: /* @__PURE__ */ jsx("div", { className: "container", children: /* @__PURE__ */ jsxs("p", { className: "footer__text", children: [
      "Built with React • MIT License •",
      /* @__PURE__ */ jsx("a", { href: "https://github.com/Lissy93", className: "footer__link", target: "_blank", rel: "noopener", children: "Alicia Sykes" })
    ] }) }) })
  ] });
}
async function render(city = "London") {
  const service = new WeatherService();
  let initialData = null;
  let initialError = null;
  try {
    initialData = await service.getWeatherByCity(city);
  } catch (error) {
    initialError = error.message;
  }
  const html = renderToString(/* @__PURE__ */ jsx(App, { initialData, initialError }));
  const state = JSON.stringify({ city, initialData, initialError }).replace(/</g, "\\u003c");
  return { html, state };
}
export {
  render
};
