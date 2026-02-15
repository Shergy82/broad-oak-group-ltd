'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, LatLngExpression } from 'leaflet';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

interface ProjectLocation {
  project: Project;
  coords: LatLngExpression;
}

const customIcon = new Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
});

export function ProjectMap() {
  const [locations, setLocations] = useState<ProjectLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'projects'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      
      const geocodingPromises = projects.map(async (project) => {
        try {
          const response = await fetch(`/api/geocode?address=${encodeURIComponent(project.address)}`);
          if (!response.ok) return null;
          const data = await response.json();
          if (data.error) return null;
          return {
            project,
            coords: [data.lat, data.lng] as LatLngExpression,
          };
        } catch (error) {
          console.error(`Failed to geocode ${project.address}`, error);
          return null;
        }
      });

      const results = await Promise.all(geocodingPromises);
      setLocations(results.filter((r): r is ProjectLocation => r !== null));
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <Skeleton className="h-[500px] w-full" />;
  }

  return (
    <MapContainer
      center={[53.4808, -2.2426]} // Default center on Manchester, UK
      zoom={7}
      style={{ height: '500px', width: '100%', borderRadius: '0.5rem' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {locations.map(({ project, coords }) => (
        <Marker key={project.id} position={coords} icon={customIcon}>
          <Popup>
            <div className="font-semibold">{project.address}</div>
            {project.manager && <p>Manager: {project.manager}</p>}
            {project.eNumber && <p>E-Number: {project.eNumber}</p>}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
