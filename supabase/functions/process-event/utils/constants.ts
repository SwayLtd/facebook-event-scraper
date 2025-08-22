/**
 * utils/constants.ts
 * 
 * Constants and configuration values for Edge Function
 * Includes geocoding exceptions and banned genres from original Node.js implementation
 */

// Configuration constants
export const DRY_RUN = false; // Set true for dry-run mode (no DB writes)
export const FUZZY_THRESHOLD = 0.75; // Similarity threshold for fuzzy matching
export const MIN_GENRE_OCCURRENCE = 3; // Minimum occurrences for genre assignment

// Festival-specific constants  
export const MAX_GENRES_REGULAR = 5; // Maximum genres for regular events
export const MAX_GENRES_FESTIVAL = 10; // Maximum genres for festivals
export const FESTIVAL_FALLBACK_GENRES = 5; // Fallback genres for festivals when threshold not met

// Geocoding exceptions (from original geocoding_exceptions.json)
export const GEOCODING_EXCEPTIONS: Record<string, string> = {
    "Kompass": "Kompass Klub"
};

// Banned genres list (from original utils/constants.js)
export const BANNED_GENRES = [
    "90s", "Disco", "Dub", "Guaracha", "Bootleg", "Montreal", "Lebanon", "Stereo", 
    "Berghain", "Jaw", "Not", "Monster", "Dream", "Drone", "Eurodance", "Storytelling", 
    "Nostalgic", "Guitar", "Art", "Future", "Romania", "Drums", "Atmosphere", "Emo", 
    "Lyrical", "Indonesia", "Mood", "Mellow", "Work", "Feminism", "Download", "This", 
    "Poetry", "Sound", "Malibu", "Twek", "Money", "Orgasm", "Cover", "Viral", "Sexy", 
    "Z", "Nas", "Weird", "P", "Indonesion", "Funky", "Tearout", "Uplifting", "Love", 
    "Core", "Violin", "Simpsons", "Riddim", "World Music", "Dancehall", "Gbr", "Fußball", 
    "German", "New", "Eargasm", "Ecstasy", "Coldwave", "Brazilian", "Beat", "Song", 
    "Soulful", "Smooth", "Contemporary", "Ballad", "Modern", "Beyonce", "Occult", "Evil", 
    "Vinyl", "2000's", "Dog", "Gangsta", "Hair", "Soundtrack", "Hard Drance", "Bassline", 
    "Queer", "Interview", "Krautrock", "Soundscape", "Darkwave", "Atmospheric", "Americana", 
    "Mpc", "Detroit", "Fast", "Argentina", "Emotional", "Germany", "Frankfurt", "Karlsruhe", 
    "Driving", "Cosmic", "Summer", "Basement", "Beachbar", "Party", "Producer", "Alive", 
    "Pulse", "Coding", "Offensive", "Alex", "Time", "Soho", "Spring", "Aus", "X", 
    "Modern Dancehall", "Elektra", "Piano", "Italo", "Synth", "Ghetto", "Moombahton", 
    "Ghetto", "Chicago", "Happy", "80s", "Munich", "Melancholic", "Samples", "Madrid", 
    "Amapiano", "00s", "Breakbeat", "Retro", "Breakz", "Spain", "Pandora", "Tropical", 
    "Latin Pop", "Night", "Aussie", "Australian", "Fire", "Hot", "Spotify", "Ur", 
    "2step", "Lonely", "Sad", "Angry", "Heavy", "Hex", "A", "Complex", "Freestyle", 
    "Mainstream", "All", "Long", "Antifa", "Horror", "Scary", "Japan", "Popular", 
    "Memphis", "Nostalgia", "Ost", "Speech", "Shoegaze", "Orchestral", "London", "Kinky", 
    "Tresor", "Chillout", "Cool", "Sun", "Ethnic", "Banjo", "Trippy", "Persian", 
    "Traditional", "Persian Traditional", "Bochka", "Oh", "God", "Kids", "Compilation", 
    "Ghost", "Space", "Christ", "Based", "De", "Juke", "Gent", "Valearic", "Ebm", 
    "Sac-sha", "Amsterdam", "Noise", "Eclectic", "Hi-nrg", "Antwerp", "Feelgood", "Body", 
    "Indie Dance", "Barcelona", "Fusion", "C", "Comedy", "Zephyr", "E", "Tiktok", 
    "Brasil", "O", "It", "Us", "Yes", "Scantraxx", "Qlimax", "Style", "Italian", 
    "Spiritual", "Quiet", "Best", "Denver", "Colorado", "Soca", "Bobo", "G", "Zouk", 
    "Booba", "Game", "Cello", "Jam", "Hardtekk", "Break", "Goa", "Boogie", "Idm", 
    "Haldtime", "Spanish", "Screamo", "Ra", "Jersey", "Organ", "Palestine", "Congo", 
    "Healing", "Minecraft", "Cyberpunk", "Television", "Film", "Cursed", "Crossbreed", 
    "Funama", "Kuduro", "Mashups", "Collaboration", "France", "Alien", "Banger", "Tool", 
    "Insomnia", "Flow", "Kafu", "Adele", "Makina", "Manchester", "Salford", "Macedonia", 
    "Japanese", "Relax", "Relaxing", "Relaxation", "Is", "Bdr", "Bier", "Jckson", 
    "Jersey Club", "Big Room", "Brooklyn", "Coffee", "Green", "Tekkno", "Flips", "Sia", 
    "Ccr", "Ai", "Unicorn", "Q", "Aversion", "Gym", "Get", "Buningman", "Rotterdam", 
    "Matrix", "Indian", "Brazil", "S", "Hybrid", "Beats", "Singer", "Ans", "Theme", 
    "Future Bass", "Club House", "Glam", "Aggressive", "Prog", "Technoid", "Funny", 
    "Raggamuffin", "Bangface", "Bandcamp", "Bristol", "Organic", "Brazilian Phonk", 
    "Revolution", "Afterlife", "Rockabilly", "Tune", "Brixton", "Psydub", "Harmony", 
    "Montana", "Imaginarium", "Cheesy", "Choral", "other", "mixtape", "world", "venice", 
    "hate", "bbc", "original", "hip", "Indie", "dan", "wave", "J", "deep", "holiday", 
    "berlin", "Classic", "fun", "Electric", "Leftfield", "Italo-disco", "Electronica", 
    "Singer-songwriter", "alternative", "sampled", "anime", "hit", "speed garage", 
    "groovy", "donk", "latin", "R", "soul", "trash", "vocal", "alternative rock", 
    "werewolf", "christmas", "xmas", "amen", "fox", "you", "Dl", "girl", "Intelligent", 
    "audio", "musical", "tony", "moon", "ukf", "zombies", "Complextro", "Doom", "death", 
    "Monstercat", "cake", "scene", "queen", "slam", "fox", "Czech", "workout", "winter", 
    "modus", "iaginarium", "avalon", "fullon", "football", "colombia", "portugal", 
    "badass", "recorder", "chile", "road", "breton", "sufi", "chanson", "noize", 
    "balada", "running", "footwork", "santa", "crazy", "microwave", "bop", "great", 
    "carnaval", "standard", "demo", "twilight", "female", "hippie", "community", 
    "meditative", "yoga", "meditation", "drop", "haunting", "chant", "Birmingham", 
    "opium", "combo", "austria", "old", "worldwide", "free", "rap", "d", "snap", "n", 
    "hip-hop", "hiphip", "breaks", "electronic", "belgian", "belgium", "up", "noir", 
    "bass", "murder", "ep", "rave", "bad", "oldschool", "music", "remix", "track", 
    "podcast", "dance", "set", "festival", "ecstacy", "uk", "live", "paris", "internet", 
    "episode", "r", "D", "club", "dj", "mix", "radio", "soundcloud", "sesh"
];

// Known festivals for detection (case-insensitive)
export const KNOWN_FESTIVALS = [
    'let it roll', 'tomorrowland', 'ultra', 'coachella', 'burning man',
    'glastonbury', 'lollapalooza', 'bonnaroo', 'electric daisy carnival',
    'edc', 'defqon', 'qlimax', 'mysteryland', 'awakenings', 'dour',
    'rock werchter', 'pukkelpop', 'graspop', 'rampage', 'rampage open air',
    'nature one', 'love parade', 'fusion', 'boom festival', 'ozora',
    'psytrance', 'hadra', 'antaris', 'voov', 'garbicz', 'fusion festival'
];

// Supported social media platforms for enrichment
export const SUPPORTED_PLATFORMS = {
    // Music platforms
    'spotify': 'spotify',
    'soundcloud': 'soundcloud', 
    'youtube': 'youtube',
    'apple_music': 'apple_music',
    'deezer': 'deezer',
    'bandcamp': 'bandcamp',
    'tidal': 'tidal',
    // Social platforms
    'instagram': 'instagram',
    'tiktok': 'tiktok',
    'facebook': 'facebook',
    'twitter': 'twitter',
    'x': 'twitter', // X is the new Twitter
    // Other
    'wikipedia': 'wikipedia'
};

// Email patterns for extraction and categorization
export const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
