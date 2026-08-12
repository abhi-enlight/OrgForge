'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2, Copy, Check, Lock, Code2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { cn } from '@/lib/utils';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface GeneratedArtifact {
  filePath: string;
  metadataType: string;
  skillUsed: string;
  skillVersion: string;
  content: string;
}

interface ArtifactViewerProps {
  onProceedToImpact: () => void;
  artifacts?: GeneratedArtifact[];
}

export default function ArtifactViewer({ onProceedToImpact, artifacts = [] }: ArtifactViewerProps) {
  const [copied, setCopied] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState(artifacts.length > 0 ? artifacts[0].filePath : '');

  const selectedArtifact = artifacts.find(a => a.filePath === selectedFilePath) || artifacts[0];
  const xmlContent = selectedArtifact ? selectedArtifact.content : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(xmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-brand-border pb-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-blue">
              <FileCode2 className="w-3.5 h-3.5 text-brand-blue" />
              STAGE 4: GENERATED METADATA ARTIFACTS
            </span>
            <Badge variant="pass" isMono size="sm">
              XSD API v64.0 OK
            </Badge>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-dark">Review Generated Metadata XML</h2>
        </div>

        {/* Skill provenance badge */}
        {selectedArtifact && (
          <div className="flex items-center gap-2.5 bg-brand-surface/70 p-2.5 rounded-xl border border-brand-border text-xs font-mono">
            <Lock className="w-4 h-4 text-brand-blue shrink-0" />
            <div>
              <span className="block font-bold text-brand-dark">{selectedArtifact.skillUsed}</span>
              <span className="block text-[10px] text-slate-500">Pinned Lock: {selectedArtifact.skillVersion}</span>
            </div>
          </div>
        )}
      </div>

      {/* Code Editor Container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-0 rounded-xl overflow-hidden border border-slate-800 shadow-xl bg-slate-950">
        {/* File Sidebar */}
        <div className="md:col-span-3 bg-slate-900 p-4 border-b md:border-b-0 md:border-r border-slate-800 space-y-3">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-bold">
            Artifact Files ({artifacts.length})
          </span>
          {artifacts.map((artifact) => {
            const fileName = artifact.filePath.split('/').pop() || artifact.filePath;
            return (
              <button
                key={artifact.filePath}
                type="button"
                onClick={() => setSelectedFilePath(artifact.filePath)}
                className={cn(
                  'w-full p-2.5 rounded-lg border text-xs font-mono cursor-pointer flex items-center justify-between transition-colors text-left',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/60',
                  selectedFilePath === artifact.filePath
                    ? 'bg-brand-blue/20 border-brand-blue text-blue-300 font-bold'
                    : 'border-transparent text-slate-400 hover:bg-slate-800'
                )}
              >
                <span className="truncate">{fileName}</span>
              </button>
            );
          })}
        </div>

        {/* Editor Main */}
        <div className="md:col-span-9 flex flex-col">
          <div className="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
            <span className="text-xs font-mono text-slate-400 flex items-center gap-2 min-w-0">
              <Code2 className="w-4 h-4 text-brand-blue shrink-0" />
              <span className="truncate">{selectedArtifact ? selectedArtifact.filePath.split('/').pop() : 'No file selected'}</span>
            </span>
            <button
              onClick={handleCopy}
              className="text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded transition-colors shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div className="h-72 w-full pt-2">
            <Editor
              height="100%"
              defaultLanguage="xml"
              theme="vs-dark"
              value={xmlContent}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: 'Fira Code',
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="primary" size="lg" onClick={onProceedToImpact}>
          Proceed to Blast Radius Analysis
        </Button>
      </div>
    </Card>
  );
}
