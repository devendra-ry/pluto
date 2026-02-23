import { serverEnv } from '@/shared/config/server'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function normalizeOrigin(value: string | null | undefined): string | null {
    if (!value) return null
    try {
        return new URL(value).origin
    } catch {
        return null
    }
}

function sanitizeNextPath(value: string | null): string {
    if (!value) return '/'
    if (!value.startsWith('/') || value.startsWith('//')) return '/'
    return value
}

function getAllowedOrigins(origin: string): Set<string> {
    const allowed = new Set<string>([origin])
    const envOrigins = [
        normalizeOrigin(serverEnv.APP_URL),
        normalizeOrigin(serverEnv.NEXT_PUBLIC_APP_URL),
    ]
    for (const envOrigin of envOrigins) {
        if (envOrigin) allowed.add(envOrigin)
    }
    return allowed
}

function resolveRedirectOrigin(request: Request, origin: string): string {
    const allowedOrigins = getAllowedOrigins(origin)
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || ''
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'

    if (forwardedHost) {
        const candidateOrigin = normalizeOrigin(`${forwardedProto}://${forwardedHost}`)
        if (candidateOrigin && allowedOrigins.has(candidateOrigin)) {
            return candidateOrigin
        }
    }

    const appOrigin = normalizeOrigin(serverEnv.APP_URL) || normalizeOrigin(serverEnv.NEXT_PUBLIC_APP_URL)
    if (appOrigin) {
        return appOrigin
    }

    return origin
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = sanitizeNextPath(searchParams.get('next'))
    const redirectOrigin = resolveRedirectOrigin(request, origin)

    if (code) {
        const cookieStore = await cookies()
        const supabase = createClient(cookieStore)
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${redirectOrigin}${next}`)
        }
    }

    return NextResponse.redirect(`${redirectOrigin}/login?error=auth_failed`)
}

