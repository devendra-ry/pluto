import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    // if "next" is in search params, use it as the redirection URL
    const next = searchParams.get('next') ?? '/'

    if (code) {
        const cookieStore = await cookies()
        const supabase = createClient(cookieStore)
        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            const host = request.headers.get('host')
            const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
            const protocol = request.headers.get('x-forwarded-proto') || 'https'

            const isLocalEnv = process.env.NODE_ENV === 'development'

            if (isLocalEnv) {
                return NextResponse.redirect(new URL(next, request.url).toString())
            }

            // In production, prioritize forwardedHost, then host
            const finalHost = forwardedHost || host
            if (finalHost) {
                // Ensure we don't redirect to localhost if we're in "production" mode but headers are missing
                if (finalHost.includes('localhost') || finalHost.includes('127.0.0.1')) {
                    return NextResponse.redirect(new URL(next, request.url).toString())
                }
                return NextResponse.redirect(`${protocol}://${finalHost}${next}`)
            }

            // Fallback to the origin from request details if headers are missing
            return NextResponse.redirect(new URL(next, request.url).toString())
        }
    }

    // return the user to an error page with instructions
    const { origin } = new URL(request.url)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
