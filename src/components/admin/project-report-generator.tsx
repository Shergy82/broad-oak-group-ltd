
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

    doc.setFontSize(18);
    doc.text(`End of Project Report: ${project.address}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${format(new Date(), 'PPP p')}`, 14, 28);
    let finalY = 35;

    const allPhotos = files.filter(f => f.type?.startsWith('image/'));
    const allOtherFiles = files.filter(f => !f.type?.startsWith('image/'));

    if (includeType === 'all' || includeType === 'files') {
      doc.addPage();
      finalY = 22;
      doc.setFontSize(16);
      doc.text('Project Documents', 14, finalY);
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
        doc.text('No documents for this project.', 14, finalY);
        finalY += 10;
      }
    }

    if (includeType === 'all' || includeType === 'photos') {
      const photosToInclude = allPhotos.filter(p => selectedUserIds.has(p.uploaderId));
      if (photosToInclude.length > 0) {
        doc.addPage();
        finalY = 22;
        doc.setFontSize(16);
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
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(`${photo.name} - Uploaded by ${photo.uploaderName}`, 15, finalY);
            finalY += 15;
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
