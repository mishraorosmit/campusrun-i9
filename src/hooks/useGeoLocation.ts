import { useState, useEffect, useCallback } from 'react';

export interface GeoLocationState {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  error: string | null;
  isSimulated: boolean;
  isLoading: boolean;
}

// Campus Center reference default
const DEFAULT_CAMPUS_LAT = 20.2485;
const DEFAULT_CAMPUS_LNG = 85.8010;

export function useGeoLocation(options?: { simulate?: boolean }) {
  const [state, setState] = useState<GeoLocationState>({
    lat: DEFAULT_CAMPUS_LAT,
    lng: DEFAULT_CAMPUS_LNG,
    accuracy: 10,
    heading: null,
    speed: null,
    error: null,
    isSimulated: options?.simulate ?? false,
    isLoading: true,
  });

  const setSimulatedPosition = useCallback((lat: number, lng: number) => {
    setState((prev) => ({
      ...prev,
      lat,
      lng,
      isSimulated: true,
      error: null,
      isLoading: false,
    }));
  }, []);

  const toggleSimulation = useCallback((enable: boolean) => {
    setState((prev) => ({ ...prev, isSimulated: enable }));
  }, []);

  useEffect(() => {
    if (state.isSimulated) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation is not supported by your browser',
        isLoading: false,
        isSimulated: true,
      }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          error: null,
          isSimulated: false,
          isLoading: false,
        });
      },
      (err) => {
        setState((prev) => ({
          ...prev,
          error: err.message,
          isLoading: false,
          isSimulated: true, // Fallback to simulated campus point if user denies GPS
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [state.isSimulated]);

  return {
    ...state,
    setSimulatedPosition,
    toggleSimulation,
  };
}
