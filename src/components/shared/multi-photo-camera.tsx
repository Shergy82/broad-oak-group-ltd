
'use client';

import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Trash2 } from 'lucide-react';
import { Spinner } from './spinner';
import { useToast } from '@/hooks/use-toast';

interface GeolocationPosition {
    coords: {
        latitude: number;
        longitude: number;
    };
}

interface MultiPhotoCameraProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    requiredCount: number;
    onUploadComplete: (files: File[]) => void;
    taskName: string;
}

export function MultiPhotoCamera({ open, onOpenChange, requiredCount, onUploadComplete, taskName }: MultiPhotoCameraProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [photos, setPhotos] = useState<string[]>([]);
    const [blobs, setBlobs] = useState<Blob[]>([]);
    const [isCapturing, setIsCapturing] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            const getCameraPermission = async () => {
                try {
                    // Request video-only stream, preferring the back camera
                    const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                    setStream(mediaStream);
                    if (videoRef.current) {
                        videoRef.current.srcObject = mediaStream;
                    }
                } catch (error) {
                    console.error('Error accessing camera:', error);
                    toast({
                        variant: 'destructive',
                        title: 'Camera Access Denied',
                        description: 'Please enable camera permissions in your browser settings.',
                    });
                    onOpenChange(false);
                }
            };
            getCameraPermission();
        } else {
            // Cleanup on close
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            setStream(null);
            setPhotos([]);
            setBlobs([]);
        }

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const getGeolocation = (): Promise<GeolocationPosition | null> => {
        return new Promise((resolve) => {
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => resolve(position),
                    (error) => {
                        let errorMessage = 'Could not determine your location.';
                        switch(error.code) {
                            case error.PERMISSION_DENIED:
                                errorMessage = 'Location access was denied. Please enable it in your browser settings.';
                                break;
                            case error.POSITION_UNAVAILABLE:
                                errorMessage = 'Location information is unavailable on this device.';
                                break;
                            case error.TIMEOUT:
                                errorMessage = 'The request to get your location timed out.';
                                break;
                        }
                        toast({
                            variant: 'destructive',
                            title: 'Geolocation Failed',
                            description: errorMessage,
                        });
                        resolve(null)
                    },
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Geolocation Not Supported',
                    description: 'Your browser does not support geolocation.',
                });
                resolve(null);
            }
        });
    };

    const handleCapture = async () => {
        if (videoRef.current && videoRef.current.readyState >= 3) { // readyState >= HAVE_CURRENT_DATA
            setIsCapturing(true);
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

                const location = await getGeolocation();
                const timestamp = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });

                // --- Text Overlay ---
                const fontSize = Math.max(18, Math.round(canvas.height * 0.025));
                const padding = Math.round(fontSize * 0.5);
                const lineHeight = fontSize * 1.2;

                context.font = `bold ${fontSize}px Arial`;
                context.fillStyle = 'white';
                context.strokeStyle = 'black';
                context.lineWidth = Math.max(2, fontSize / 8);
                context.textAlign = 'left';
                context.textBaseline = 'bottom';

                const lines = [];
                if (location) {
                    lines.push(`Lat: ${location.coords.latitude.toFixed(5)}, Lon: ${location.coords.longitude.toFixed(5)}`);
                }
                lines.push(timestamp);
                
                // Draw lines from bottom up
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const yPos = canvas.height - padding - (i * lineHeight);
                    context.strokeText(line, padding, yPos);
                    context.fillText(line, padding, yPos);
                }
                // --- End Text Overlay ---

                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                setPhotos(prev => [...prev, dataUrl]);

                canvas.toBlob(blob => {
                    if (blob) {
                        setBlobs(prev => [...prev, blob]);
                    }
                }, 'image/jpeg', 0.9);
            }
            setIsCapturing(false);
        }
    };

    const handleDeletePhoto = (index: number) => {
        setPhotos(prev => prev.filter((_, i) => i !== index));
        setBlobs(prev => prev.filter((_, i) => i !== index));
    };

    const handleUpload = () => {
        const files = blobs.map((blob, index) => new File([blob], `photo-${taskName.replace(/\s+/g, '-')}-${Date.now()}-${index + 1}.jpg`, { type: 'image/jpeg' }));
        onUploadComplete(files);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Take Photos for: {taskName}</DialogTitle>
                    <DialogDescription>
                        Minimum required: {requiredCount}. Photos taken: {photos.length}.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
                        {stream ? (
                            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center"><Spinner size="lg" /></div>
                        )}
                        {isCapturing && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Spinner /></div>}
                    </div>
                    <div className="space-y-4">
                        <Button onClick={handleCapture} disabled={isCapturing || !stream} className="w-full">
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                        </Button>
                        <div className="h-64 border rounded-md p-2 overflow-y-auto">
                            {photos.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center pt-10">Captured photos will appear here.</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {photos.map((photo, index) => (
                                        <div key={index} className="relative group">
                                            <img src={photo} alt={`capture ${index}`} className="rounded-md" />
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100"
                                                onClick={() => handleDeletePhoto(index)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleUpload}
                        disabled={photos.length < requiredCount}
                        className="w-full"
                    >
                        <Upload className="mr-2 h-4 w-4" /> Upload {photos.length} Photo(s)
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
