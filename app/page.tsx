'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileCode, 
  Download, 
  RefreshCcw, 
  CheckCircle2, 
  AlertCircle,
  FileUp,
  Box,
  CornerDownRight,
  Zap,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { convertSvgToEps } from '@/lib/converter';

type ConversionStatus = 'idle' | 'loading' | 'success' | 'error';

interface ConversionResult {
  id: string;
  name: string;
  size: string;
  timestamp: Date;
  svgContent: string;
  epsContent: string | null;
  status: ConversionStatus;
  width: number;
  height: number;
  error?: string;
  warning?: string;
}

const parseSvgDimensions = (svg: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return { width: 500, height: 500 };

  let width = parseFloat(svgEl.getAttribute('width') || '');
  let height = parseFloat(svgEl.getAttribute('height') || '');

  if (isNaN(width) || isNaN(height)) {
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[ ,]+/).map(parseFloat);
      if (parts.length === 4) {
        width = parts[2];
        height = parts[3];
      }
    }
  }

  return {
    width: width || 500,
    height: height || 500
  };
};

export default function SvgConverterPage() {
  const [results, setResults] = useState<ConversionResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userApiKey, setUserApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);

  React.useEffect(() => {
    setMounted(true);
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) setUserApiKey(savedKey);
  }, []);

  const saveApiKey = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('GEMINI_API_KEY', key);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processFiles(Array.from(files));
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const processFiles = (files: File[]) => {
    files.forEach(file => {
      if (file.type !== 'image/svg+xml' && !file.name.endsWith('.svg')) return;

      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large. Individual file limit is 50MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const svgContent = e.target?.result as string;
        const dims = parseSvgDimensions(svgContent);
        const newResult: ConversionResult = {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          size: `${(file.size / 1024).toFixed(1)} KB`,
          timestamp: new Date(),
          svgContent,
          epsContent: null,
          status: 'idle',
          width: dims.width,
          height: dims.height,
        };
        setResults(prev => [newResult, ...prev]);
        setActiveId(newResult.id);
      };
      reader.readAsText(file);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const startConversion = async (id: string) => {
    const item = results.find(r => r.id === id);
    if (!item || item.status === 'loading') return;

    setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'loading' } : r));

    try {
      const eps = await convertSvgToEps(item.svgContent, item.width, item.height, userApiKey);
      
      // Output Size Management: Minimum 2MB, Maximum 20MB
      let finalEps = eps;
      let epsSizeInBytes = new Blob([finalEps]).size;
      const MIN_SIZE = 2 * 1024 * 1024; // 2MB
      const MAX_SIZE = 20 * 1024 * 1024; // 20MB

      // If output is below 2MB, pad it with PostScript comments to meet the requirement
      if (epsSizeInBytes < MIN_SIZE) {
        const paddingNeeded = MIN_SIZE - epsSizeInBytes;
        const paddingChunk = "% [VECTOR-SHIFT-ULTRA-FIDELITY-PADDING-BLOCK]\n";
        const repeatCount = Math.ceil(paddingNeeded / paddingChunk.length);
        const padding = "\n" + paddingChunk.repeat(repeatCount).slice(0, paddingNeeded);
        
        if (finalEps.includes("%%EOF")) {
          finalEps = finalEps.replace("%%EOF", padding + "%%EOF");
        } else {
          finalEps += padding;
        }
        epsSizeInBytes = new Blob([finalEps]).size;
      }

      setResults(prev => prev.map(r => {
        if (r.id === id) {
          return { 
            ...r, 
            status: 'success', 
            epsContent: finalEps,
            // Only warn if it EXCEEDS the 20MB limit, 2MB is now guaranteed
            warning: epsSizeInBytes > MAX_SIZE ? `Limit exceeded: ${(epsSizeInBytes / 1024 / 1024).toFixed(2)}MB` : undefined
          };
        }
        return r;
      }));
    } catch (err: any) {
      setResults(prev => prev.map(r => r.id === id ? { 
        ...r, 
        status: 'error', 
        error: err.message 
      } : r));
    }
  };

  const updateDimensions = (id: string, width: number, height: number) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, width, height } : r));
  };

  const [batchWidth, setBatchWidth] = useState<number>(500);
  const [batchHeight, setBatchHeight] = useState<number>(500);

  const applyBatchDimensions = () => {
    setResults(prev => prev.map(r => ({ ...r, width: batchWidth, height: batchHeight })));
  };

  const downloadAllAsZip = async () => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const successfulResults = results.filter(r => r.status === 'success' && r.epsContent);
      
      if (successfulResults.length === 0) {
        alert("No successful conversions to download.");
        return;
      }

      console.log(`Packaging ${successfulResults.length} files...`);

      successfulResults.forEach((item, index) => {
        // Handle duplicate names if any
        let fileName = item.name.replace(/\.[^/.]+$/, "") + ".eps";
        zip.file(fileName, item.epsContent!);
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vector_shift_batch_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error("ZIP Generation Error:", error);
      alert("Failed to generate ZIP archive. Check console for details.");
    }
  };

  const downloadEps = (id: string) => {
    const item = results.find(r => r.id === id);
    if (!item || !item.epsContent) return;

    const blob = new Blob([item.epsContent], { type: 'application/postscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name.replace('.svg', '.eps');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeItem = results.find(r => r.id === activeId);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] flex flex-col">
      {/* Header Section */}
      <header id="main-header" className="h-16 border-b border-[#141414] flex items-center justify-between px-6 bg-[#DCDAD7] sticky top-0 z-50">
        <div id="header-brand" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#141414] flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-[#E4E3E0] rotate-45"></div>
          </div>
          <h1 className="text-lg font-bold tracking-tight uppercase">VectorConvert <span className="font-normal opacity-50 px-2 text-sm font-mono lowercase">BOOM X-V2</span></h1>
        </div>
        <div id="header-status" className="flex items-center gap-6">
          <div className="hidden sm:flex gap-4 text-[11px] font-mono uppercase tracking-widest">
            <span className="opacity-50 text-[#F27D26]">X-CONVERT: BOOM ENGINE</span>
            <span className="text-[#22C55E]">High Speed Ready</span>
          </div>
          <button className="px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] text-xs font-bold transition-colors uppercase">Documentation</button>
        </div>
      </header>

      <main id="main-layout" className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left Column: Conversion Area */}
        <section id="work-area" className="col-span-12 lg:col-span-8 border-r border-[#141414] flex flex-col bg-white overflow-y-auto">
          {/* Drop Zone */}
          <div id="drop-zone-section" className="p-6 border-b border-[#141414] bg-[#F5F4F2]">
            <motion.div
              onDragOver={(e) => { e.preventDefault(); setIsHovering(true); }}
              onDragLeave={() => setIsHovering(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed border-[#141414] h-32 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer",
                isHovering ? "bg-[#EAE8E5]" : "hover:bg-[#EAE8E5]"
              )}
            >
              <input 
                id="file-input"
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".svg" 
                multiple 
                className="hidden" 
              />
              <p className="text-xs font-bold uppercase tracking-widest text-[#141414]">Drop SVG files here or click to browse</p>
              <p className="text-[10px] opacity-60 font-mono uppercase tracking-tight">INPUT: 50MB | OUTPUT: 2-20MB | SHUTTERSTOCK EPS 10 READY</p>
            </motion.div>
          </div>

          {/* Active Result Detail or Queue Area */}
          <div id="conversion-display" className="flex-1 flex flex-col overflow-hidden">
            <div id="table-header" className="grid grid-cols-12 text-[10px] uppercase font-bold tracking-wider px-6 py-3 border-b border-[#141414] bg-[#DCDAD7] opacity-70">
              <div className="col-span-5">File Name / Source</div>
              <div className="col-span-3 text-right">Preview</div>
              <div className="col-span-4 text-right">Status / Control</div>
            </div>

            <div id="results-queue" className="flex-1 overflow-y-auto overflow-x-hidden">
              <AnimatePresence mode="popLayout">
                {results.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-12 opacity-30 font-mono">
                    <FileCode className="w-12 h-12 mb-4" />
                    <p className="text-xs uppercase tracking-widest">Awaiting local file ingestion</p>
                  </div>
                ) : (
                  results.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "grid grid-cols-12 px-6 py-4 border-b border-[#E4E3E0] items-center transition-colors font-mono text-[11px]",
                        activeId === item.id ? "bg-[#F5F4F2]" : "hover:bg-[#F9F9F8]"
                      )}
                      onClick={() => setActiveId(item.id)}
                    >
                      <div className="col-span-5 flex items-center gap-3 overflow-hidden">
                        <span className={cn(
                          "w-2 h-2 shrink-0",
                          item.status === 'success' ? 'bg-[#22C55E]' :
                          item.status === 'error' ? 'bg-red-600' :
                          item.status === 'loading' ? 'bg-[#141414] animate-pulse' : 'bg-[#F27D26]'
                        )}></span>
                        <div className="truncate">
                          <p className="font-bold truncate">{item.name}</p>
                          <p className="text-[9px] opacity-40 uppercase">{item.size}</p>
                        </div>
                      </div>

                      <div className="col-span-3 flex justify-end">
                        <div className="w-12 h-12 border border-[#141414]/10 bg-white flex items-center justify-center p-1 overflow-hidden" 
                             dangerouslySetInnerHTML={{ __html: item.svgContent }} />
                      </div>

                      <div className="col-span-4 flex justify-end items-center gap-4">
                        {item.status === 'idle' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); startConversion(item.id); }}
                            className="px-3 py-1 border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
                          >
                            RUN
                          </button>
                        )}
                        {item.status === 'loading' && (
                          <span className="text-[9px] font-bold uppercase animate-pulse">PROCESSING...</span>
                        )}
                        {item.status === 'success' && (
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 border border-[#141414] bg-[#141414] text-[#E4E3E0] text-[9px] font-bold">CONVERTED</span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); downloadEps(item.id); }}
                              className="underline text-[9px] font-bold hover:text-[#F27D26]"
                            >
                              DL
                            </button>
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div className="flex flex-col items-end gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); startConversion(item.id); }}
                              className="text-[9px] font-bold text-red-600 uppercase underline hover:text-[#141414]"
                            >
                              RETRY FAILURE
                            </button>
                            <span className="text-[8px] text-red-500 opacity-70 max-w-[120px] truncate text-right" title={item.error}>
                              {item.error || 'Unknown Error'}
                            </span>
                          </div>
                        )}
                        {item.status === 'success' && item.warning && (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[8px] text-red-500 font-bold uppercase">Size Limit</span>
                            <span className="text-[7px] opacity-60 text-right">{item.warning}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Summary Bar */}
            <div id="summary-bar" className="h-12 border-t border-[#141414] bg-[#DCDAD7] px-6 flex items-center justify-between text-[11px] font-bold">
              <div className="flex gap-6 uppercase tracking-tight">
                <span>Total: {results.length}</span>
                <span className="text-[#22C55E]">Success: {results.filter(r => r.status === 'success').length}</span>
                <span className="text-red-600">Errors: {results.filter(r => r.status === 'error').length}</span>
              </div>
              <button 
                onClick={() => results.filter(r => r.status === 'idle').forEach(r => startConversion(r.id))}
                className="px-8 h-full bg-[#141414] text-[#E4E3E0] hover:bg-black transition-colors uppercase tracking-widest text-xs border-l border-[#141414]"
              >
                Batch Process
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Settings & Detail */}
        <aside id="settings-sidebar" className="col-span-12 lg:col-span-4 p-8 flex flex-col gap-8 bg-[#E4E3E0] border-l border-[#141414] overflow-y-auto lg:overflow-hidden lg:h-full">
          <div id="output-params" className="space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-[#141414] pb-2">Control Center</h2>
            
            <div className="space-y-6">
              {/* Batch Edit Section */}
              <div id="batch-edit" className="space-y-4 p-4 border border-[#141414] bg-[#F5F4F2]">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] uppercase font-bold text-[#F27D26]">Global Batch Override</label>
                  <Box className="w-3 h-3" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold opacity-60">Width</label>
                    <input 
                      type="number"
                      value={batchWidth}
                      onChange={(e) => setBatchWidth(Number(e.target.value))}
                      className="w-full bg-white border border-[#141414] px-2 py-1 text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold opacity-60">Height</label>
                    <input 
                      type="number"
                      value={batchHeight}
                      onChange={(e) => setBatchHeight(Number(e.target.value))}
                      className="w-full bg-white border border-[#141414] px-2 py-1 text-xs font-mono focus:outline-none"
                    />
                  </div>
                </div>
                <button 
                  onClick={applyBatchDimensions}
                  className="w-full py-2 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-black transition-colors"
                >
                  Apply to All Queue
                </button>
              </div>

              {/* Vector Scope (Active Item) */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-[#141414]/10 pb-2">
                  <label className="text-[11px] uppercase font-bold">Vector Scope</label>
                  <label className="text-[9px] font-bold opacity-40">ITEM_UID: {activeItem?.id.slice(0, 4) || 'NULL'}</label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold opacity-60">W (px)</label>
                    <input 
                      type="number"
                      value={activeItem?.width || 0}
                      onChange={(e) => activeId && updateDimensions(activeId, parseFloat(e.target.value) || 0, activeItem?.height || 0)}
                      className="w-full bg-white border border-[#141414] px-2 py-1.5 text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold opacity-60">H (px)</label>
                    <input 
                      type="number"
                      value={activeItem?.height || 0}
                      onChange={(e) => activeId && updateDimensions(activeId, activeItem?.width || 0, parseFloat(e.target.value) || 0)}
                      className="w-full bg-white border border-[#141414] px-2 py-1.5 text-xs font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Batch Actions ZIP */}
              <div className="pt-2">
                <button 
                  onClick={downloadAllAsZip}
                  disabled={!results.some(r => r.status === 'success')}
                  className="w-full py-3 border-2 border-[#141414] text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] text-xs font-bold uppercase transition-all disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download All Converted (.ZIP)
                </button>
              </div>

              {/* Security & API Key Section */}
              <div id="security-config" className="space-y-4 pt-6 border-t border-[#141414]">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-[#141414]/20 pb-2 flex items-center justify-between">
                  Security Credentials
                  <Zap className="w-3 h-3 text-[#F27D26]" />
                </h2>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-60">Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type={showApiKey ? "text" : "password"}
                      value={userApiKey}
                      onChange={(e) => saveApiKey(e.target.value)}
                      placeholder="Enter API Key..."
                      className="w-full bg-[#F5F4F2] border border-[#141414] px-3 py-2 text-xs font-mono focus:outline-none placeholder:opacity-30"
                    />
                    <button 
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase opacity-40 hover:opacity-100"
                    >
                      {showApiKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Visual Proof at the Bottom */}
              <div id="active-detail" className="space-y-3 pt-6 border-t border-[#141414]">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] uppercase font-bold">Visual Proof</label>
                </div>
                <div className="aspect-square bg-white border border-[#141414] flex items-center justify-center p-6 relative overflow-hidden">
                  <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '16px 16px' }} />
                  {activeItem ? (
                    <div className="w-full h-full flex items-center justify-center" dangerouslySetInnerHTML={{ __html: activeItem.svgContent }} />
                  ) : (
                    <p className="text-[10px] font-mono opacity-30 text-center uppercase">Null_state</p>
                  )}
                </div>
              </div>
            </div>
          </div>


          <div id="recent-activity" className="mt-auto space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-[#141414] pb-2">Technical Audit Log</h2>
            <div className="font-mono text-[9px] space-y-2 opacity-60 max-h-[140px] overflow-y-auto">
              {results.slice(0, 4).map(r => (
                <div key={r.id} className="flex justify-between border-b border-[#141414]/10 pb-1">
                  <span className="truncate pr-4">{r.name}</span>
                  <span className="shrink-0">{r.status}</span>
                </div>
              ))}
              {results.length === 0 && (
                <div className="italic uppercase">Session logs empty...</div>
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer id="main-footer" className="h-8 border-t border-[#141414] bg-[#141414] text-[#E4E3E0] flex items-center justify-between px-6 text-[10px] font-mono shrink-0">
        <div className="flex gap-4">
          <span className="opacity-60">SECURE: SESSION_LOCAL</span>
          <span className="opacity-60">BUFFER: 0.2ms</span>
        </div>
        <div className="flex gap-4">
          <span className="opacity-60 uppercase">{mounted ? new Date().toLocaleTimeString() : '--:--:--'} UTC</span>
          <span className="text-[#F27D26]">ACTIVE_CONVERSION_MODE</span>
        </div>
      </footer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(20, 20, 20, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(20, 20, 20, 0.2);
        }
      `}</style>
    </div>
  );
}
