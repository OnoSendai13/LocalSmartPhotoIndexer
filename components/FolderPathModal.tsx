import React, { useState, useEffect, useRef } from 'react';
import {
  searchFolderPaths,
  probeFolder,
  FolderSearchResult,
  FolderProbeResult,
} from '../services/apiService';

interface FolderPathModalProps {
  /** Name of the folder as seen by the browser (webkitRelativePath root) */
  folderName: string;
  /** Called with the confirmed absolute path, or null if cancelled */
  onConfirm: (absolutePath: string | null) => void;
}

/** Convert a Windows path to its WSL2 equivalent. */
function toWslPath(winPath: string): string | null {
  const m = winPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!m) return null;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/**
 * Modal that finds the real server-side path for a folder selected in the browser.
 *
 * The browser never reveals the absolute path (security restriction).  Instead of
 * guessing, this modal queries the backend to find ALL existing paths that match
 * the folder name across common photo directories, then lets the user pick the
 * correct one — with a manual override still available.
 */
export const FolderPathModal: React.FC<FolderPathModalProps> = ({
  folderName,
  onConfirm,
}) => {
  const [value, setValue] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<FolderProbeResult | null>(null);
  const [search, setSearch] = useState<FolderSearchResult | null>(null);
  const [searching, setSearching] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-search for the folder on mount
  useEffect(() => {
    const runSearch = async () => {
      try {
        const result = await searchFolderPaths(folderName);
        setSearch(result);
        // If exactly one valid path was found, pre-select it
        if (result.validPaths.length === 1) {
          setValue(result.validPaths[0]);
        }
      } catch {
        /* search failed — user will type manually */
      } finally {
        setSearching(false);
      }
    };
    runSearch();

    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [folderName]);

  const handleChange = (v: string) => {
    setValue(v);
    setProbe(null);
  };

  const handleConfirm = () => {
    const trimmed = value.trim().replace(/[/\\]+$/, '');
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onConfirm(null);
  };

  const handleProbe = async () => {
    const trimmed = value.trim().replace(/[/\\]+$/, '');
    if (!trimmed) return;
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await probeFolder(trimmed));
    } catch {
      setProbe({
        inputPath: trimmed,
        exists: false,
        platform: '?',
        homedir: '?',
        cwd: '?',
        parentPath: '?',
        parentEntries: [],
      });
    } finally {
      setProbing(false);
    }
  };

  // Detect if the current input looks like a Windows path and compute WSL equivalent
  const wslEquivalent = value ? toWslPath(value) : null;
  const wslPaths = search
    ? search.validPaths.flatMap(p => {
        const ws = toWslPath(p);
        return ws ? [p, ws] : [p];
      })
    : [];

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
            Le navigateur ne révèle pas le chemin réel. Le serveur a cherché où
            "<strong className="text-white">{folderName}</strong>" existe —
            cliquez sur le bon chemin ci-dessous, ou tapez-le manuellement.
          </p>

          {/* Auto-found paths */}
          {searching && (
            <div className="text-center text-xs text-zinc-500 animate-pulse">
              Recherche sur le serveur…
            </div>
          )}
          {search && search.validPaths.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-green-400">
                ✅ {search.validPaths.length} emplacement(s) trouvé(s) :
              </p>
              <div className="space-y-1">
                {wslPaths.map((p, i) => (
                  <button
                    key={`${p}-${i}`}
                    type="button"
                    onClick={() => handleChange(p)}
                    className={`block w-full text-left font-mono text-sm px-3 py-2 rounded-lg border transition-colors ${
                      value === p
                        ? 'border-orange-500 bg-orange-900/30 text-orange-200'
                        : wslEquivalent === p
                          ? 'border-blue-600/40 bg-blue-900/20 text-blue-200 text-xs'
                          : 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/60'
                    }`}
                    title={wslEquivalent === p ? 'Équivalent WSL2' : undefined}
                  >
                    {p}
                    {wslEquivalent === p && <span className="ml-2 text-blue-400">(WSL)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {search && search.validPaths.length === 0 && !searching && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs">
              <p className="text-amber-200">
                Aucun dossier nommé « <strong>{folderName}</strong> » trouvé dans les
                emplacements courants du serveur. Tapez le chemin manuellement ci-dessous.
              </p>
            </div>
          )}

          {/* Manual override input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">Ou tapez le chemin :</label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={e => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-zinc-950 border border-zinc-700 focus:border-orange-500 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none transition-colors"
                placeholder="/chemin/vers/votre/dossier"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !value.trim()}
                title="Vérifier si le serveur trouve ce dossier"
                className="px-3 py-2.5 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 transition-colors whitespace-nowrap"
              >
                {probing ? '…' : '🔍 Tester'}
              </button>
            </div>
          </div>

          {/* Probe result */}
          {probe && (
            <div
              className={`rounded-lg p-3 text-xs space-y-1.5 border ${
                probe.exists
                  ? 'bg-green-900/30 border-green-700/50'
                  : 'bg-red-900/30 border-red-700/50'
              }`}
            >
              <p
                className={`font-medium ${
                  probe.exists ? 'text-green-300' : 'text-red-300'
                }`}
              >
                {probe.exists
                  ? '✅ Chemin trouvé par le serveur !'
                  : '❌ Chemin introuvable côté serveur'}
              </p>
              {!probe.exists && probe.parentPath !== '?' && (
                <p className="text-zinc-400">
                  Vérifiez l'intégralité du chemin (serveur:{' '}
                  <span className="font-mono text-zinc-200">{probe.platform}</span>
                  ).
                </p>
              )}
            </div>
          )}

          {/* WSL hint */}
          {wslEquivalent && !value.startsWith('/mnt/') && (
            <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 text-xs space-y-1">
              <p className="text-blue-200 font-medium">⚠️ Chemin Windows détecté</p>
              <p className="text-blue-300">
                Si le serveur tourne dans <strong>WSL2</strong> :
              </p>
              <button
                type="button"
                onClick={() => handleChange(wslEquivalent)}
                className="block w-full text-left font-mono text-blue-100 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-700/40 rounded px-2 py-1 transition-colors mt-1"
              >
                {wslEquivalent}
              </button>
            </div>
          )}
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
