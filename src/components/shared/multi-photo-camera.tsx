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
                    () => resolve(null),
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            } else {
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
                const timestamp = new Date().toLocaleString('en-GB');

                // Add text overlay
                const fontSize = Math.max(24, canvas.height * 0.03);
                context.font = `${fontSize}px Arial`;
                context.fillStyle = 'white';
                context.strokeStyle = 'black';
                context.lineWidth = 4;
                context.textAlign = 'left';
                context.textBaseline = 'bottom';

                const text = `${timestamp}${location ? ` | Lat: ${location.coords.latitude.toFixed(5)}, Lon: ${location.coords.longitude.toFixed(5)}` : ''}`;
                context.strokeText(text, 20, canvas.height - 20);
                context.fillText(text, 20, canvas.height - 20);

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
