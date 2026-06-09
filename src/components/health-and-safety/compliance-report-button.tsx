'use client';

import { useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { FileBadge, Download } from 'lucide-react';
import { format } from 'date-fns';
import { Spinner } from '@/components/shared/spinner';
import type { HSAcknowledgement } from '@/types';

export function ComplianceReportButton() {
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    toast({ title: "Generating Audit Log...", description: "Fetching all H&S signatures." });

    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const q = query(collection(db, 'hsAcknowledgements'), orderBy('acknowledgedAt', 'desc'));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as HSAcknowledgement));

      if (data.length === 0) {
        toast({ variant: 'destructive', title: 'No Data', description: 'No H&S acknowledgments have been recorded yet.' });
        setIsGenerating(false);
        return;
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      
      // Header
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('H&S Compliance Audit Log', 14, 25);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated on: ${format(new Date(), 'PPP p')}`, 14, 34);

      // Summary Table
      autoTable(doc, {
        startY: 50,
        head: [['Operative', 'Digital Signature', 'Document Acknowledged', 'Timestamp']],
        body: data.map(ack => [
          ack.userName,
          ack.signature,
          ack.fileName,
          ack.acknowledgedAt?.toDate ? format(ack.acknowledgedAt.toDate(), 'dd/MM/yyyy HH:mm:ss') : 'N/A'
        ]),
        headStyles: { fillColor: [6, 95, 212] },
        styles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      });

      doc.save(`HS_Compliance_Audit_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast({ title: "Success", description: "Audit log downloaded." });
    } catch (error: any) {
      console.error("Failed to generate compliance report:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not generate PDF.' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleGenerateReport} disabled={isGenerating}>
      {isGenerating ? <Spinner /> : <><FileBadge className="mr-2 h-4 w-4" /> Compliance Audit Log</>}
    </Button>
  );
}
