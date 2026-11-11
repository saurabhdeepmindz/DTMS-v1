import type { ChildProcess } from 'node:child_process';

export function createProcessSupervisor() {
    const activeProcesses = new Set<ChildProcess>();

    const release = (child: ChildProcess): void => {
        activeProcesses.delete(child);
    };

    const track = (child: ChildProcess): void => {
        activeProcesses.add(child);
    };

    const terminate = (child: ChildProcess): void => {
        if (child.exitCode !== null) return;

        if (child.pid && process.platform !== 'win32') {
            try {
                process.kill(-child.pid, 'SIGKILL');
                return;
            } catch {}
        }

        child.kill('SIGKILL');
    };

    const terminateAll = (): void => {
        for (const child of activeProcesses) terminate(child);
    };

    return { release, track, terminate, terminateAll };
}
