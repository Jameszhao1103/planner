import { escapeHtml, routeTouchesSelected, shortLabel } from "./shared.js";
import { makeItemFlowBlock, timelineBlockTitle } from "./timeline.js";

export function createMapController({ mapCanvas, mapStatus, selectItem }) {
  const mapRuntime = {
    promise: null,
    map: null,
    infoWindow: null,
    markers: [],
    polylines: [],
    renderToken: 0,
  };

  function setMapStatus(message, isError = false) {
    if (!message) {
      clearMapStatus();
      return;
    }

    mapStatus.textContent = message;
    mapStatus.classList.remove("hidden");
    mapStatus.classList.toggle("error", isError);
  }

  function clearMapStatus() {
    mapStatus.textContent = "";
    mapStatus.classList.add("hidden");
    mapStatus.classList.remove("error");
  }

  function clearGoogleMapOverlays() {
    mapRuntime.markers.forEach((marker) => marker.setMap(null));
    mapRuntime.polylines.forEach((polyline) => polyline.setMap(null));
    mapRuntime.markers = [];
    mapRuntime.polylines = [];
  }

  function destroyGoogleMap() {
    clearGoogleMapOverlays();
    mapRuntime.infoWindow?.close();
    mapRuntime.infoWindow = null;
    mapRuntime.map = null;
  }

  function buildMapPoints(trip, items) {
    const placeById = new Map(trip.places.map((place) => [place.place_id, place]));
    const countsByPlace = new Map();

    return items
      .filter((item) => item.place_id)
      .map((item, index) => {
        const place = placeById.get(item.place_id);
        if (!place) {
          return null;
        }

        const occurrence = countsByPlace.get(place.place_id) ?? 0;
        countsByPlace.set(place.place_id, occurrence + 1);
        const location = jitterMapPoint(place, occurrence);

        return {
          item,
          place,
          label: String(index + 1),
          lat: location.lat,
          lng: location.lng,
        };
      })
      .filter(Boolean);
  }

  function jitterMapPoint(place, occurrence) {
    if (!occurrence) {
      return { lat: place.lat, lng: place.lng };
    }

    const angle = occurrence * 2.1;
    const radius = 0.0022 * Math.min(occurrence, 3);
    return {
      lat: place.lat + Math.sin(angle) * radius,
      lng: place.lng + Math.cos(angle) * radius,
    };
  }

  function computeMapPositions(mapPoints) {
    const lats = mapPoints.map((point) => point.lat);
    const lngs = mapPoints.map((point) => point.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latPadding = Math.max(0.01, (maxLat - minLat) * 0.25);
    const lngPadding = Math.max(0.01, (maxLng - minLng) * 0.25);
    const positions = new Map();

    mapPoints.forEach((point) => {
      const x = 12 + (((point.lng - (minLng - lngPadding)) / (maxLng - minLng + lngPadding * 2)) * 76);
      const y = 14 + (((maxLat + latPadding - point.lat) / (maxLat - minLat + latPadding * 2)) * 72);
      positions.set(point.item.id, { x, y });
    });

    return positions;
  }

  function renderFallbackMap(trip, items, mapPoints, selectedItem, message = "", isError = false) {
    destroyGoogleMap();
    if (mapPoints.length === 0) {
      mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
      setMapStatus(message, isError);
      return;
    }

    const positions = computeMapPositions(mapPoints);
    const itemIds = new Set(items.map((item) => item.id));
    const routes = trip.routes.filter(
      (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
    );
    const routeHtml = routes
      .map((route) => {
        const fromPosition = positions.get(route.from_item_id);
        const toPosition = positions.get(route.to_item_id);
        if (!fromPosition || !toPosition) {
          return "";
        }

        const deltaX = toPosition.x - fromPosition.x;
        const deltaY = toPosition.y - fromPosition.y;
        const width = Math.sqrt(deltaX ** 2 + deltaY ** 2);
        const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
        return `<div class="route ${route.mode}${routeTouchesSelected(route, selectedItem?.id) ? " selected" : ""}" style="left:${fromPosition.x}%;top:${fromPosition.y}%;width:${width}%;transform:rotate(${angle}deg);"></div>`;
      })
      .join("");

    const markerHtml = mapPoints
      .map((point) => {
        const position = positions.get(point.item.id);
        if (!position) {
          return "";
        }

        const itemLabel = shortLabel(
          timelineBlockTitle(makeItemFlowBlock(point.item, new Map([[point.place.place_id, point.place]])))
        );

        return `
          <button
            type="button"
            class="marker ${markerClass(point.place.category)}${point.item.id === selectedItem?.id ? " selected" : ""}"
            data-map-item-id="${point.item.id}"
            style="left:${position.x}%;top:${position.y}%;">
            <span>${escapeHtml(point.label)}</span>
          </button>
          <div class="marker-label${point.item.id === selectedItem?.id ? " selected" : ""}" style="left:${position.x}%;top:${position.y}%;">${escapeHtml(itemLabel)}</div>
        `;
      })
      .join("");

    mapCanvas.innerHTML = `${routeHtml}${markerHtml}`;
    mapCanvas.querySelectorAll("[data-map-item-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectItem(button.dataset.mapItemId ?? null);
      });
    });
    setMapStatus(message, isError);
  }

  async function renderGoogleMap(trip, items, mapPoints, selectedItem, apiKey) {
    const renderToken = ++mapRuntime.renderToken;
    setMapStatus("Loading Google Map…");

    try {
      const maps = await loadGoogleMapsApi(apiKey);
      if (renderToken !== mapRuntime.renderToken) {
        return;
      }

      ensureGoogleMap(maps);
      drawGoogleMap(trip, items, mapPoints, selectedItem, maps);
      clearMapStatus();
    } catch (error) {
      if (renderToken !== mapRuntime.renderToken) {
        return;
      }

      renderFallbackMap(
        trip,
        items,
        mapPoints,
        selectedItem,
        error instanceof Error ? error.message : "Failed to load Google Maps JavaScript API.",
        true
      );
    }
  }

  function ensureGoogleMap(maps) {
    if (mapRuntime.map) {
      return;
    }

    mapCanvas.innerHTML = "";
    mapRuntime.map = new maps.Map(mapCanvas, {
      center: { lat: 35.5951, lng: -82.5515 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    mapRuntime.infoWindow = new maps.InfoWindow();
  }

  function drawGoogleMap(trip, items, mapPoints, selectedItem, maps) {
    clearGoogleMapOverlays();

    const itemIds = new Set(items.map((item) => item.id));
    const routes = trip.routes.filter(
      (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
    );
    const pointByItemId = new Map(mapPoints.map((point) => [point.item.id, point]));
    const bounds = new maps.LatLngBounds();

    mapPoints.forEach((point) => {
      bounds.extend({ lat: point.lat, lng: point.lng });
      const marker = new maps.Marker({
        map: mapRuntime.map,
        position: { lat: point.lat, lng: point.lng },
        title: point.item.title,
        label: {
          text: point.label,
          color: point.item.id === selectedItem?.id ? "#145a4a" : "#ffffff",
          fontWeight: "700",
        },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: point.item.id === selectedItem?.id ? 13 : 11,
          fillColor: markerColor(point.place.category),
          fillOpacity: 1,
          strokeColor: point.item.id === selectedItem?.id ? "#145a4a" : "#ffffff",
          strokeWeight: point.item.id === selectedItem?.id ? 3 : 2,
        },
        zIndex: point.item.id === selectedItem?.id ? 9 : 4,
      });

      marker.addListener("click", () => {
        selectItem(point.item.id);
      });

      mapRuntime.markers.push(marker);
    });

    routes.forEach((route) => {
      const fromPoint = pointByItemId.get(route.from_item_id);
      const toPoint = pointByItemId.get(route.to_item_id);
      if (!fromPoint || !toPoint) {
        return;
      }

      const style = routeStyle(route.mode);
      const isSelected = routeTouchesSelected(route, selectedItem?.id);
      const path = buildRoutePath(maps, route, fromPoint, toPoint);
      path.forEach((point) => {
        bounds.extend(point);
      });

      const polyline = new maps.Polyline({
        map: mapRuntime.map,
        path,
        geodesic: false,
        strokeColor: style.strokeColor,
        strokeOpacity: isSelected ? 1 : style.strokeOpacity,
        strokeWeight: isSelected ? style.strokeWeight + 2 : style.strokeWeight,
        icons: style.icons,
        zIndex: isSelected ? 3 : 1,
      });

      mapRuntime.polylines.push(polyline);
    });

    if (mapPoints.length === 1) {
      mapRuntime.map?.setCenter({ lat: mapPoints[0].lat, lng: mapPoints[0].lng });
      mapRuntime.map?.setZoom(13);
      return;
    }

    if (!bounds.isEmpty()) {
      mapRuntime.map?.fitBounds(bounds, 56);
    }
  }

  function buildRoutePath(maps, route, fromPlace, toPlace) {
    const stepPath = decodeRouteStepPath(maps, route.steps);
    if (stepPath.length >= 2) {
      return stepPath;
    }

    if (route.polyline && maps.geometry?.encoding?.decodePath) {
      try {
        return normalizeDecodedPath(maps.geometry.encoding.decodePath(route.polyline));
      } catch (_error) {
        // Fall back to a straight line if the polyline payload is not encoded.
      }
    }

    return [
      { lat: fromPlace.lat, lng: fromPlace.lng },
      { lat: toPlace.lat, lng: toPlace.lng },
    ];
  }

  function decodeRouteStepPath(maps, steps = []) {
    if (!maps.geometry?.encoding?.decodePath || !Array.isArray(steps) || steps.length === 0) {
      return [];
    }

    const points = [];
    steps.forEach((step) => {
      if (!step?.polyline) {
        return;
      }

      try {
        const decoded = normalizeDecodedPath(maps.geometry.encoding.decodePath(step.polyline));
        decoded.forEach((point, index) => {
          const previous = points[points.length - 1];
          if (
            index > 0 &&
            previous &&
            previous.lat === point.lat &&
            previous.lng === point.lng
          ) {
            return;
          }
          points.push(point);
        });
      } catch (_error) {
        // Ignore broken step polylines and let the overview polyline handle the route.
      }
    });

    return points;
  }

  function normalizeDecodedPath(path) {
    return Array.from(path ?? []).map((point) => ({
      lat: typeof point.lat === "function" ? point.lat() : point.lat,
      lng: typeof point.lng === "function" ? point.lng() : point.lng,
    }));
  }

  function routeStyle(mode) {
    if (mode === "walk") {
      return {
        strokeColor: "#2d6cdf",
        strokeOpacity: 0,
        strokeWeight: 3,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              strokeWeight: 2.4,
              scale: 4,
            },
            offset: "0",
            repeat: "14px",
          },
        ],
      };
    }

    if (mode === "transit") {
      return {
        strokeColor: "#1b5cc8",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
              scale: 4,
            },
            offset: "0",
            repeat: "18px",
          },
        ],
      };
    }

    if (mode === "taxi") {
      return {
        strokeColor: "#4474c4",
        strokeOpacity: 0.92,
        strokeWeight: 5,
      };
    }

    return {
      strokeColor: "#2d6cdf",
      strokeOpacity: 0.94,
      strokeWeight: 5,
    };
  }

  function markerColor(category) {
    if (category === "airport") return "#245fce";
    if (category === "hotel") return "#8b4db3";
    if (category === "restaurant") return "#d28325";
    return "#2d8c54";
  }

  function markerClass(category) {
    if (category === "airport") return "airport";
    if (category === "hotel") return "hotel";
    if (category === "restaurant") return "restaurant";
    return "sight";
  }

  function loadGoogleMapsApi(apiKey) {
    if (window.google?.maps) {
      return Promise.resolve(window.google.maps);
    }

    if (mapRuntime.promise) {
      return mapRuntime.promise;
    }

    mapRuntime.promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };

      window.gm_authFailure = () => {
        mapRuntime.promise = null;
        finish(
          reject,
          new Error(
            "Google Maps browser key was rejected. Check Maps JavaScript API access and localhost referrer restrictions."
          )
        );
      };

      const existing = document.querySelector('script[data-google-maps-loader="true"]');
      if (existing) {
        existing.addEventListener("load", () => finish(resolve, window.google.maps), { once: true });
        existing.addEventListener(
          "error",
          () => {
            mapRuntime.promise = null;
            finish(reject, new Error("Failed to load Google Maps JavaScript API."));
          },
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = "true";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=geometry`;
      script.addEventListener(
        "load",
        () => {
          if (!window.google?.maps) {
            mapRuntime.promise = null;
            finish(reject, new Error("Google Maps loaded without window.google.maps."));
            return;
          }

          finish(resolve, window.google.maps);
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          mapRuntime.promise = null;
          finish(
            reject,
            new Error("Failed to load Google Maps JavaScript API. Check the browser key and network access.")
          );
        },
        { once: true }
      );
      document.head.appendChild(script);
    });

    return mapRuntime.promise;
  }

  return {
    renderMap({ provider, mapsBrowserApiKey, trip, day, selectedItem }) {
      const items = day?.items ?? [];
      const mapPoints = buildMapPoints(trip, items);
      if (!day || mapPoints.length === 0) {
        destroyGoogleMap();
        mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
        clearMapStatus();
        return;
      }

      if (provider !== "google") {
        renderFallbackMap(
          trip,
          items,
          mapPoints,
          selectedItem,
          "Provider is mock. Restart the server in Google mode to render the live map."
        );
        return;
      }

      if (!mapsBrowserApiKey) {
        renderFallbackMap(
          trip,
          items,
          mapPoints,
          selectedItem,
          "Missing browser map key. Set GOOGLE_MAPS_BROWSER_API_KEY or GOOGLE_MAPS_API_KEY and restart the server.",
          true
        );
        return;
      }

      void renderGoogleMap(trip, items, mapPoints, selectedItem, mapsBrowserApiKey);
    },
  };
}
