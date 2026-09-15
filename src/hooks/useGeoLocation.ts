import { useState, useEffect, useCallback, useRef } from 'react';

export interface GeoLocationState {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  error: string | null;
  isSimulated: boolean;
  isLoading: boolean;
  isPermissionDenied: boolean;
}

// Campus Center reference default (ITER Bhubaneswar)
export const DEFAULT_CAMPUS_LAT = 20.2485;
export const DEFAULT_CAMPUS_LNG = 85.8010;

export function useGeoLocation(options?: { simulate?: boolean }) {
  const [state, setState] = useState<GeoLocationState>({
    lat: DEFAULT_CAMPUS_LAT,
    lng: DEFAULT_CAMPUS_LNG,
    accuracy: 10,
    heading: null,
    speed: null,
    error: null,
    isSimulated: options?.simulate ?? false,
    isLoading: !(options?.simulate ?? false),
    isPermissionDenied: false,
  });

  const [retryCounter, setRetryCounter] = useState(0);
  const watchIdRef = useRef<number | null>(null);

  const setSimulatedPosition = useCallback((lat: number, lng: number) => {
    setState((prev) => ({
      ...prev,
      lat,
      lng,
      isSimulated: true,
      error: null,
      isLoading: false,
      isPermissionDenied: false,
    }));
  }, []);

  const toggleSimulation = useCallback((enable: boolean) => {
    setState((prev) => ({
      ...prev,
      isSimulated: enable,
      error: null,
      isLoading: !enable,
      isPermissionDenied: false,
    }));
  }, []);

  const retry = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
      isLoading: true,
      isPermissionDenied: false,
    }));
    setRetryCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    if (state.isSimulated) {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation is not supported by your browser.',
        isLoading: false,
        isPermissionDenied: false,
      }));
      return;
    }

    let isSubscribed = true;
    let fallbackAttempted = false;

    // Monitor permission status proactively if Permissions API is available
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((permissionStatus) => {
          permissionStatus.onchange = () => {
            if (!isSubscribed) return;
            if (permissionStatus.state === 'granted') {
              retry();
            } else if (permissionStatus.state === 'denied') {
              setState((prev) => ({
                ...prev,
                isPermissionDenied: true,
                error: 'Location access was denied in browser settings.',
                isLoading: false,
              }));
            }
          };
        })
        .catch(() => {
          // Permissions API optional; ignore if query not supported
        });
    }

    const handleSuccess = (pos: GeolocationPosition) => {
      if (!isSubscribed) return;
      setState({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        heading: pos.coords.heading ?? null,
        speed: pos.coords.speed ?? null,
        error: null,
        isSimulated: false,
        isLoading: false,
        isPermissionDenied: false,
      });
    };

    const handleError = (err: GeolocationPositionError) => {
      if (!isSubscribed) return;

      // If high-accuracy timed out, retry once with standard accuracy
      if (err.code === err.TIMEOUT && !fallbackAttempted) {
        fallbackAttempted = true;
        navigator.geolocation.getCurrentPosition(handleSuccess, (secondErr) => {
          if (!isSubscribed) return;
          setState((prev) => ({
            ...prev,
            error: secondErr.message || 'Location timed out. Please try again.',
            isLoading: false,
            isPermissionDenied: false,
          }));
        }, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 30000,
        });
        return;
      }

      const isDenied = err.code === err.PERMISSION_DENIED;
      setState((prev) => ({
        ...prev,
        error: isDenied
          ? 'Location permission was denied. Please allow access in your browser settings.'
          : err.message || 'Unable to retrieve location.',
        isLoading: false,
        isPermissionDenied: isDenied,
        // Crucial: do NOT set isSimulated: true so the UI can show the permission/error state
      }));
    };

    // 1. Request immediate position fix
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 10000,
      }
    );

    // 2. Attach continuous position watcher
    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 3000,
      }
    );
    watchIdRef.current = watchId;

    return () => {
      isSubscribed = false;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [state.isSimulated, retryCounter, retry]);

  return {
    ...state,
    setSimulatedPosition,
    toggleSimulation,
    retry,
  };
}
