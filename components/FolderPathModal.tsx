import React, { useState, useEffect, useRef } from 'react';

interface FolderPathModalProps {
  /** Name of the folder as seen by the browser (webkitRelativePath root) */
  folderName: string;
  /** Suggested absolute path pre-filled in the input */
  suggestedPath: string;
  /** Called with the confirmed absolute path, or null if cancelled */
  onConfirm: (absolutePath: string | null) => void;
}

/**
 * Convert a Windows path to its WSL2 equivalent, e.g.
 *   C:\Users\Alice\Photos  →  /mnt/c/Users/Alice/Photos
 * Returns null if the input is not a Windows-style absolute path.
 */
function toWslPath(winPath: string): string | null {
  const m = winPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!m) return null;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

/**
 * Modal dialog asking the user for the absolute server-side path of a folder.
 *
 * Why is this necessary?
 * The browser's file picker only exposes relative paths (webkitRelativePath).
 * The backend needs the absolute disk path to:
 *   - Serve photo previews via /api/photos/:id/preview
 *   - Write AI-generated tags to EXIF/XMP metadata
 *   - Persist paths across sessions (no re-linking needed)
 */
export const FolderPathModal: React.FC<FolderPathModalProps> = ({
  folderName,
  suggestedPath,
  onConfirm,
}) => {
  const [value, setValue] = useState(suggestedPath);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus & select all on open so the user can just type the correct path
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // Update value when suggestedPath changes (async system info load)
    setValue(suggestedPath);
  }, [suggestedPath]);

  const handleConfirm = () => {
    const trimmed = value.trim().replace(/[/\\]+$/, ''); // remove trailing slashes
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onConfirm(null);
  };

  // Detect if the current input looks like a Windows path and compute WSL equivalent
  const wslEquivalent = toWslPath(value);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-800/50">
          <span className="text-2xl">📁</span>
          <div>
            <h3 className="font-semibold text-white text-sm">Chemin absolu du dossier</h3>
            <p className="text-xs text-zinc-400 truncate max-w-sm">"{folderName}"</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Indiquez le <strong className="text-white">chemin complet</strong> de ce dossier
            tel qu'il est accessible par le <strong className="text-white">serveur backend</strong>.
          </p>

          {/* Why is this needed */}
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
            <p className="text-zinc-300 font-medium mb-1">Pourquoi ce chemin est nécessaire :</p>
            <p>• <span className="text-zinc-200">Previews</span> — le backend lit les fichiers depuis le disque</p>
            <p>• <span className="text-zinc-200">Métadonnées EXIF</span> — les tags IA sont écrits dans les fichiers</p>
            <p>• <span className="text-zinc-200">Reprise après crash</span> — les chemins sont persistés en base</p>
          </div>

          {/* Input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">Chemin absolu (côté serveur)</label>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-zinc-950 border border-zinc-700 focus:border-orange-500 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none transition-colors"
              placeholder="/chemin/vers/votre/dossier"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* WSL hint — shown when input looks like a Windows path */}
          {wslEquivalent && (
            <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 text-xs space-y-1">
              <p className="text-blue-200 font-medium">⚠️ Chemin Windows détecté</p>
              <p className="text-blue-300">
                Si le serveur tourne dans WSL2, utilisez plutôt :
              </p>
              <button
                type="button"
                onClick={() => setValue(wslEquivalent)}
                className="block w-full text-left font-mono text-blue-100 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-700/40 rounded px-2 py-1 transition-colors mt-1"
                title="Cliquer pour utiliser ce chemin WSL"
              >
                {wslEquivalent}
              </button>
              <p className="text-blue-400 text-[10px]">Cliquez sur le chemin ci-dessus pour l'utiliser.</p>
            </div>
          )}

          {/* Format hints */}
          <div className="text-xs text-zinc-500 space-y-0.5">
            <p className="text-zinc-400 font-medium">Exemples de formats :</p>
            <p>Linux / macOS : <code className="text-zinc-300">/home/alice/Photos/Vacances</code></p>
            <p>Windows (WSL2) : <code className="text-zinc-300">/mnt/c/Users/Alice/Pictures/Vacances</code></p>
            <p>Windows natif : <code className="text-zinc-300">C:\Users\Alice\Pictures\Vacances</code></p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/30">
          <button
            onClick={() => onConfirm(null)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value.trim()}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white transition-colors"
          >
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
};
