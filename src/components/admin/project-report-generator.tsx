
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
    const logoPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABGAAAACHCAMAAABYx2pAAAAAjVBMVEUAdLj////+gJn/jKv/lLL/o8n/uc3/z+H/2uj/8Pf/+/7/d7v/fpH/hKT/pcn/vcj/0N//3uj/dbr/hKT/pcn/vcj/0N//3uj/dbr/hKT/pcn/vcj/0N//3uj/dbr/hKT/pcn/vcj/0N//3uj/dbr/hKT/pcn/vcj/0N//3uj/dbr/hKT/pcn/vcj/0N//3uhPOAmDAAAAL3RSTlMAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywuLzAxMjN/Pz7dAAADWklEQVR42u3d63KbMBQGYBgxBkMQwZmAwZzD//8lF0gS0mpJ2pY56s5+VdD5YGFk+fGkgwAAAAAAAAAAAAAAAAAAAAAAAAAAgBvH5+fn4/P9vX7f4/P93s/3+/l+v/fn/f75+Hj5/u91+7+fD/d/v29uAAAAAAAAAAAAAAAAAAAAAAAAAACA+wuvz/f3+nzPez2/5z1uPx7v9/58v/f78/l+v/f7P37+5fN+v/9v/gIAAAAAAAAAAAAAAAAAAAAAAAAAAPAX8Hq/1/s/n+/3vNf9/u/3vNfr/V/vy/f7P7/e7/1+v/f7vV+f7/e/33sDAAAAAAAAAAAAAAAAAAAAAAAAAADeBd7v9f483/fzXq/3+38/n++Xz/f7+Xy/X+/P6+f7+fP6fr/35y8AAAAAAAAAAAAAAAAAAAAAAAAAAIAf4Pd6v9fr/Z/v9bzX4/N+v/f7fb/P++vl+/3+vN7v/fy8Xt/v/V6fD1/v/1/+AgAAAAAAAAAAAAAAAAAAAAAAAAAA8D+F1+f7fT/v9bzH43m/v9fr8Xq/9+ftXq/3f/78eL++37/d/4sAAAAAAAAAAAAAAAAAAAAAAAAAAAC8D7ye7/f6/M97rcfr+X6v9/v8vN7v/f5+/3u/v7zfp/3+fD/vDAAAAAAAAAAAAAAAAAAAAAAAAAAAwD/L+z9/Pz/fr/d+v/e83+Pz+fn2fr/P+/N+f7/e/3n7eX2+/+e/TwAAAAAAAAAAAAAAAAAAAAAAAAAAAF/B6/n+fr/H4/m83+Px/H6/l+/3frzfr8/H8/v9Xr/fr/fr/Z6fnz9eXz7+AgAAAAAAAAAAAAAAAAAAAAAAAAAA4F3g+Xy/X+/1+Lze+3q9X+/3/nx5vt/v/fnx/Px+v9/v/f3z/f7v/QkAAAAAAAAAAAAAAAAAAAAAAAAAAMAa3h+P93v9fr/nvd7z+fz+fr/X+/Pl+X6v1/vzeh9fPz6+fz//vf95AAAAAAAAAAAAAAAAAAAAAAAAAAAA4B/k+fn+fr/X+/1er+fzfr/f/fnxeLzer/f7/X6/l+f7/f7z+Hj/3P/+AAAAAAAAAAAAAAAAAAAAAAAAAAAA+GN4vt/v/f7r/V6P9/u/Pl9eP+8P+fV6vR+v9/78fH2+/+cf/wEAAAAAAAAAAAAAAAAAAAAAAAAAAIDvj+fP++v93td7ve/1+Py83+v1en+/X+/1/q/P6/v19fP+/N/jAQAAAAAAAAAAAAAAAAAAAAAAAAAA8H7/9w9vAIhV32n/5Q8vAAAAAElFTkSuQmCC';
    
    doc.setFillColor(241, 245, 249); // slate-100
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.addImage(logoPngDataUrl, 'PNG', pageMargin, 6, 16, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text('BROAD OAK GROUP', pageMargin + 22, 17);


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
    let contentAdded = false;
    doc.addPage();
    let finalY = 22;

    const ensurePageSpace = (requiredSpace: number) => {
        if (finalY + requiredSpace > pageHeight - 20) {
            doc.addPage();
            finalY = 22;
        }
    }

    const allPhotos = files.filter(f => f.type?.startsWith('image/'));
    const allOtherFiles = files.filter(f => !f.type?.startsWith('image/'));

    if (includeType === 'all' || includeType === 'files') {
      if (contentAdded) finalY += 15;
      ensurePageSpace(20);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0,0,0);
      doc.text('Project Documents', pageMargin, finalY);
      finalY += 10;
      contentAdded = true;

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
        finalY = (doc as any).lastAutoTable.finalY;
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
        if (contentAdded) finalY += 15;
        ensurePageSpace(20);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0,0,0);
        doc.text('Project Photos', 14, finalY);
        finalY += 10;
        contentAdded = true;


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

            ensurePageSpace(imgHeight + 20);
            
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
            ensurePageSpace(10);
            doc.setFontSize(9);
            doc.setTextColor(255, 0, 0);
            doc.text(`Failed to load image: ${photo.name}`, 15, finalY);
            finalY += 10;
          }
        }
      } else if (includeType === 'photos') {
        if (contentAdded) finalY += 15;
        ensurePageSpace(20);
        doc.text('Project Photos', 14, finalY);
        finalY += 10;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('No photos to include based on selected filters.', 14, finalY);
        contentAdded = true;
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
