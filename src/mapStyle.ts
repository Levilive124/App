// Dark style for the Google renderer (Android / Google on iOS).
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d2026' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a4a9b3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2026' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#262a31' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f3326' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#373c45' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#22252b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#525866' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2a2e36' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a2b' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d8c' }] },
];
