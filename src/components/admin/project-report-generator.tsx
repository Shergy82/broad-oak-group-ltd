
'use client';

import { useState, useMemo, useEffect } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { useAllUsers } from '@/hooks/use-all-users';
import { Spinner } from '../shared/spinner';
import { ScrollArea } from '../ui/scroll-area';
import type { Project, ProjectFile, UserProfile } from '@/types';

interface ProjectReportGeneratorProps {
  project: Project;
  files: ProjectFile[];
}

export function ProjectReportGenerator({ project, files }: ProjectReportGeneratorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeType, setIncludeType] = useState<'all' | 'photos' | 'files'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const { users: allUsers, loading: usersLoading } = useAllUsers();

  const photoUploaders = useMemo(() => {
    const uploaderIds = new Set<string>();
    files.forEach(file => {
      if (file.type?.startsWith('image/')) {
        uploaderIds.add(file.uploaderId);
      }
    });
    return allUsers.filter(user => uploaderIds.has(user.uid));
  }, [files, allUsers]);

  useEffect(() => {
    if (photoUploaders.length > 0) {
      setSelectedUserIds(new Set(photoUploaders.map(u => u.uid)));
    }
  }, [photoUploaders]);

  const handleUserToggle = (userId: string) => {
    setSelectedUserIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) newSet.delete(userId);
      else newSet.add(userId);
      return newSet;
    });
  };

  const generatePdf = async () => {
    setIsGenerating(true);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const pageMargin = 14;

    // --- HEADER ---
    const logoSvg = `<svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="translate(16,16)"><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#84cc16" transform="rotate(0)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#22d3ee" transform="rotate(90)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#f87171" transform="rotate(180)"/><path d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z" fill="#fbbf24" transform="rotate(270)"/></g></svg>`;
    const logoDataUrl = `data:image/svg+xml;base64,${btoa(logoSvg)}`;

    const pngDataUrl: string = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Render at double resolution for better quality
        canvas.width = 56;
        canvas.height = 56;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 56, 56);
          resolve(canvas.toDataURL('image/png'));
        } else {
          reject(new Error('Failed to get canvas context'));
        }
      };
      img.onerror = () => reject(new Error('Failed to load SVG for conversion'));
      img.src = logoDataUrl;
    });

    doc.addImage(pngDataUrl, 'PNG', pageMargin, 11, 8, 8);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(45, 55, 72);
    doc.text('BROAD OAK GROUP', pageMargin + 12, 18);

    // --- CENTERED CONTENT ---
    const contentStartY = 60;
    const contentEndY = pageHeight - 30;
    const contentHeight = contentEndY - contentStartY;

    const mainTitle = 'End of Project Report';
    const addressText = project.address;
    const generatedDateText = `Generated on: ${format(new Date(), 'PPP p')}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    const titleDim = doc.getTextDimensions(mainTitle);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(16);
    const addressLines = doc.splitTextToSize(addressText, pageWidth - (pageMargin * 6));
    const addressHeight = (doc.getLineHeight() * addressLines.length) / doc.internal.scaleFactor;

    doc.setFontSize(10);
    const dateHeight = doc.getTextDimensions(generatedDateText).h;

    const totalBlockHeight = titleDim.h + addressHeight + dateHeight + 20;
    const blockStartY = contentStartY + (contentHeight - totalBlockHeight) / 2;
    
    let currentY = blockStartY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(45, 55, 72);
    doc.text(mainTitle, pageWidth / 2, currentY, { align: 'center' });
    currentY += titleDim.h + 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(16);
    doc.setTextColor(100, 100, 100);
    doc.text(addressLines, pageWidth / 2, currentY, { align: 'center' });
    currentY += addressHeight + 10;

    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text(generatedDateText, pageWidth / 2, currentY, { align: 'center' });
    

    // --- CONTENT PAGES ---
    let firstContentPage = true;
    let finalY = 0;

    const allPhotos = files.filter(f => f.type?.startsWith('image/'));
    const allOtherFiles = files.filter(f => !f.type?.startsWith('image/'));

    const addContentPage = () => {
        if(firstContentPage) {
            doc.addPage();
            firstContentPage = false;
        }
        finalY = 22;
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0,0,0);
    }

    if (includeType === 'all' || includeType === 'files') {
      addContentPage();
      doc.text('Project Documents', pageMargin, finalY);
      finalY += 10;
      if (allOtherFiles.length > 0) {
        (doc as any).autoTable({
          startY: finalY,
          head: [['File Name', 'Uploaded By', 'Date']],
          body: allOtherFiles.map(f => [
            f.name,
            f.uploaderName,
            f.uploadedAt ? format(f.uploadedAt.toDate(), 'dd/MM/yyyy') : '',
          ]),
        });
        finalY = (doc as any).lastAutoTable.finalY + 15;
      } else {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('No documents for this project.', 14, finalY);
        finalY += 10;
      }
    }

    if (includeType === 'all' || includeType === 'photos') {
      const photosToInclude = allPhotos.filter(p => selectedUserIds.has(p.uploaderId));
      if (photosToInclude.length > 0) {
        addContentPage();
        doc.text('Project Photos', 14, finalY);
        finalY += 10;

        for (const photo of photosToInclude) {
          try {
            const imageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(photo.url)}`;
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            const dataUrl: string = await new Promise((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            
            const imgProps = doc.getImageProperties(dataUrl);
            const imgWidth = 180;
            const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

            if (finalY + imgHeight + 20 > doc.internal.pageSize.height) {
              doc.addPage();
              finalY = 22;
            }
            doc.addImage(dataUrl, 'JPEG', 15, finalY, imgWidth, imgHeight);
            finalY += imgHeight + 5;
            
            const captionText = `${photo.name} - Uploaded by ${photo.uploaderName}`;
            const captionLines = doc.splitTextToSize(captionText, imgWidth);
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(captionLines, 15, finalY);
            const captionHeight = doc.getTextDimensions(captionLines).h;
            finalY += captionHeight + 10;

          } catch(e) {
            console.error("Could not add image to PDF", e);
            if (finalY + 10 > doc.internal.pageSize.height) {
              doc.addPage();
              finalY = 22;
            }
            doc.setFontSize(9);
            doc.setTextColor(255, 0, 0);
            doc.text(`Failed to load image: ${photo.name}`, 15, finalY);
            finalY += 10;
          }
        }
      }
    }

    doc.save(`report_${project.address.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    setIsGenerating(false);
    setIsOpen(false);
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Download className="mr-2 h-4 w-4" />
        End of Project Report
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate End of Project Report</DialogTitle>
            <DialogDescription>
              Configure the contents of the PDF report for "{project.address}".
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-6">
            <div className="space-y-3">
              <Label>Include in Report</Label>
              <RadioGroup value={includeType} onValueChange={(v) => setIncludeType(v as any)} className="flex space-x-4">
                <div className="flex items-center space-x-2"><RadioGroupItem value="all" id="all" /><Label htmlFor="all">All</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="photos" id="photos" /><Label htmlFor="photos">Photos Only</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="files" id="files" /><Label htmlFor="files">Documents Only</Label></div>
              </RadioGroup>
            </div>

            {(includeType === 'all' || includeType === 'photos') && (
              <div className="space-y-3">
                <Label>Filter Photos by Uploader</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedUserIds.size} of {photoUploaders.length} users selected
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuLabel>Photo Uploaders</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ScrollArea className="h-48">
                      {usersLoading ? <div className="p-2 text-sm text-muted-foreground">Loading users...</div> : photoUploaders.map(user => (
                        <DropdownMenuCheckboxItem
                          key={user.uid}
                          checked={selectedUserIds.has(user.uid)}
                          onCheckedChange={() => handleUserToggle(user.uid)}
                        >
                          {user.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </ScrollArea>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={generatePdf} disabled={isGenerating}>
              {isGenerating ? <Spinner /> : 'Generate PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
