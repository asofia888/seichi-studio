import React from 'react';
import { newProjectSlot, setCurrentProjectSlot } from '../services/storage';

interface ErrorBoundaryState {
  error: Error | null;
  isRecovering: boolean;
}

/**
 * Shown in place of the editor when it fails while drawing the screen, instead of a blank page.
 * The work is saved after every edit, so reloading normally brings it back. If the saved project
 * itself is what breaks the editor, the second button opens the app without it (the project
 * stays in the project list).
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, isRecovering: false };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('The editor stopped with an error:', error, info.componentStack);
  }

  private handleReload = () => window.location.reload();

  private handleOpenWithoutProject = async () => {
    this.setState({ isRecovering: true });
    // An empty slot: the app starts on the sample project, and the saved one is left as it is
    await setCurrentProjectSlot(newProjectSlot()).catch((e) => console.warn('Could not switch projects:', e));
    window.location.reload();
  };

  render() {
    const { error, isRecovering } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="h-screen w-screen bg-[#0B0D11] text-[#E6E4DF] flex items-center justify-center p-6 font-sans"
      >
        <div className="max-w-lg w-full bg-[#121620] border border-[#2b384c] rounded-xl p-6 space-y-4 shadow-2xl">
          <h1 className="text-base font-semibold text-[#D4AF37]">⛩️ 画面の表示中に問題が起きました</h1>
          <p className="text-sm leading-relaxed text-gray-300">
            編集内容は操作のたびにこのブラウザへ自動保存されています。まずは「再読み込み」をお試しください。
          </p>
          <p className="text-xs leading-relaxed text-gray-400">
            再読み込みしても同じ画面になるときは、「サンプルの状態で開き直す」を押してください。
            今のプロジェクトは消えず、ヘッダーの「プロジェクト」一覧に残ります。
          </p>
          <pre className="text-xs text-red-200 bg-[#2a1214] border border-[#7f2a2a] rounded p-2 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {error.message || String(error)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={this.handleReload}
              disabled={isRecovering}
              className="px-4 py-2 text-xs font-bold text-[#0B0D11] bg-gradient-to-r from-[#E5C07B] to-[#D4AF37] hover:brightness-110 rounded disabled:opacity-50"
            >
              再読み込み
            </button>
            <button
              onClick={this.handleOpenWithoutProject}
              disabled={isRecovering}
              className="px-4 py-2 text-xs font-semibold text-gray-200 bg-[#1b2332] hover:bg-[#253248] border border-[#3a4a60] rounded disabled:opacity-50"
            >
              サンプルの状態で開き直す
            </button>
          </div>
        </div>
      </div>
    );
  }
}
