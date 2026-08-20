import React, { useState } from "react";
import { useVideoStore } from "../store/useVideoStore";
import { Upload, Film } from "lucide-react";

export const Dropzone: React.FC = () => {
  const { analyze } = useVideoStore();
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = async () => {
    const path = await window.electronAPI.selectFile();
    if (path) analyze(path);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (file?.path) {
      analyze(file.path);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={handleFileSelect}
      className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
        isDragging
          ? "border-blue-500 bg-blue-500/10 scale-[0.99]"
          : "border-neutral-700 hover:border-neutral-500 bg-neutral-900/50"
      }`}
    >
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
        {isDragging ? <Film className="w-8 h-8 text-blue-400" /> : <Upload className="w-8 h-8" />}
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">
        Видеоны осы жерге сүйреңіз немесе таңдаңыз
      </h3>
      <p className="text-sm text-neutral-400">MP4, MOV, MKV қолданылады</p>
    </div>
  );
};