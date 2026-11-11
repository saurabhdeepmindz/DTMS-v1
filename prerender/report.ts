import type { ClientIslandDiagnostic, Diagnostic, PrerenderManifest, PrerenderRoute } from './core.ts';

export const MAX_ROUTE_REPORT_DETAILS = 100;

export type RouteReport = {
    pageId?: string;
    lang?: string;
    status?: string;
    diagnostic?: Diagnostic;
    clientIslands?: ClientIslandDiagnostic[];
};

export type PrerenderReport = {
    version: number;
    status: 'completed' | 'renderer-fallback' | 'deadline-reached';
    totals: {
        configured: number;
        eligible: number;
        rendered: number;
        fallback: number;
        deadlineSkipped: number;
        clientIslands: number;
        routeDetailsOmitted: number;
    };
    staticFormulas?: PrerenderManifest['staticFormulas'];
    routes: RouteReport[];
};

export function createPrerenderReport(): PrerenderReport {
    return {
        version: 1,
        status: 'completed',
        totals: {
            configured: 0,
            eligible: 0,
            rendered: 0,
            fallback: 0,
            deadlineSkipped: 0,
            clientIslands: 0,
            routeDetailsOmitted: 0,
        },
        routes: [],
    };
}

export function addRouteReport(report: PrerenderReport, route: RouteReport): void {
    if (report.routes.length >= MAX_ROUTE_REPORT_DETAILS) {
        report.totals.routeDetailsOmitted++;
        return;
    }

    report.routes.push(route);
}

export function omitRouteReports(report: PrerenderReport, count: number): void {
    report.totals.routeDetailsOmitted += count;
}

export function createRouteReport(
    route: PrerenderRoute,
    status: string,
    extra: Partial<RouteReport> = {}
): RouteReport {
    return {
        pageId: route.pageId,
        lang: route.lang,
        status,
        ...extra,
    };
}
