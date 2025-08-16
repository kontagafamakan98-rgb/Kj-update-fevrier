import React, { createContext, useState, useContext, useEffect } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LocationContext = createContext({});

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};

export const LocationProvider = ({ children }) => {
  const [location, setLocation] = useState(null);
  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    checkLocationPermission();
  }, []);

  const checkLocationPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setPermissionGranted(status === 'granted');
      
      if (status === 'granted') {
        loadStoredLocation();
      }
    } catch (error) {
      console.error('Error checking location permission:', error);
    }
  };

  const loadStoredLocation = async () => {
    try {
      const storedLocation = await AsyncStorage.getItem('user_location');
      const storedAddress = await AsyncStorage.getItem('user_address');
      
      if (storedLocation) {
        setLocation(JSON.parse(storedLocation));
      }
      if (storedAddress) {
        setAddress(JSON.parse(storedAddress));
      }
    } catch (error) {
      console.error('Error loading stored location:', error);
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionGranted(status === 'granted');
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting location permission:', error);
      return false;
    }
  };

  const getCurrentLocation = async () => {
    if (!permissionGranted) {
      const granted = await requestLocationPermission();
      if (!granted) {
        return { success: false, error: 'Location permission denied' };
      }
    }

    setLoading(true);
    try {
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      };

      setLocation(coords);
      await AsyncStorage.setItem('user_location', JSON.stringify(coords));

      // Reverse geocoding to get address
      const reverseGeocode = await Location.reverseGeocodeAsync(coords);
      if (reverseGeocode.length > 0) {
        const addressData = reverseGeocode[0];
        const formattedAddress = {
          street: addressData.street,
          city: addressData.city,
          region: addressData.region,
          country: addressData.country,
          formatted: `${addressData.street || ''}, ${addressData.city || ''}, ${addressData.region || ''}`.replace(/^,\s*|,\s*$/g, '')
        };
        
        setAddress(formattedAddress);
        await AsyncStorage.setItem('user_address', JSON.stringify(formattedAddress));
      }

      setLoading(false);
      return { success: true, location: coords, address: reverseGeocode[0] };
    } catch (error) {
      setLoading(false);
      console.error('Error getting current location:', error);
      return { success: false, error: 'Failed to get location' };
    }
  };

  const geocodeAddress = async (addressString) => {
    try {
      const geocoded = await Location.geocodeAsync(addressString);
      if (geocoded.length > 0) {
        const coords = {
          latitude: geocoded[0].latitude,
          longitude: geocoded[0].longitude,
        };
        return { success: true, location: coords };
      }
      return { success: false, error: 'Address not found' };
    } catch (error) {
      console.error('Error geocoding address:', error);
      return { success: false, error: 'Geocoding failed' };
    }
  };

  const calculateDistance = (coords1, coords2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (coords2.latitude - coords1.latitude) * Math.PI / 180;
    const dLon = (coords2.longitude - coords1.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(coords1.latitude * Math.PI / 180) * Math.cos(coords2.latitude * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance;
  };

  const value = {
    location,
    address,
    loading,
    permissionGranted,
    getCurrentLocation,
    geocodeAddress,
    calculateDistance,
    requestLocationPermission
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
};