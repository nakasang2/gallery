// Supabase クライアント(未設定の環境では null になり、アプリはゲストモードのみで動く)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
