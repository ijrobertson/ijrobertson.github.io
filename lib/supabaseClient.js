import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fryhforpxlavbpimaljf.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyeWhmb3JweGxhdmJwaW1hbGpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA4ODIwNDEsImV4cCI6MjA2NjQ1ODA0MX0.S5XbzUZeq4lCR2O-_siaSg86b6FQwLxvizF3yVvpidI'

export const supabase = createClient(supabaseUrl, supabaseKey)
