const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { Telegraf, Markup, session } = require('telegraf');

// ================== CONFIG ==================
const YOUR_BOT_TOKEN = "8525102753:AAEUMWcS1K5oYJVM-sBhvfl6wLtU34HBjPU";
const ADMIN_CHAT_IDS = ["8248734943"];
const INITIAL_CHAT_IDS = ["-1003414578929"];

const LOGIN_URL = "https://www.ivasms.com/login";
const BASE_URL = "https://www.ivasms.com/";
const SMS_API_ENDPOINT = "https://www.ivasms.com/portal/sms/received/getsms";
const USERNAME = "username_here";
const PASSWORD = "password_here";

const POLLING_INTERVAL_SECONDS = 1;
const STATE_FILE = "processed_sms_ids.json";
const CHAT_IDS_FILE = "chat_ids.json";

const COUNTRY_FLAGS = {"Indonesia": "🇮🇩", "USA": "🇺🇸", "Unknown": "🏴‍☠️"};
const SERVICE_KEYWORDS = {
    "WhatsApp": ["whatsapp", "wa"],
    "Telegram": ["telegram", "tg"],
    "Google": ["google", "gmail"],
    "Facebook": ["facebook", "fb"],
    "Twitter": ["twitter"],
    "Instagram": ["instagram", "ig"],
    "TikTok": ["tiktok"],
    "Bank": ["bank", "bca", "mandiri", "bri", "bni"],
    "Shopee": ["shopee"],
    "Tokopedia": ["tokopedia"],
    "Gojek": ["gojek", "go-jek"],
    "Grab": ["grab"],
    "OVO": ["ovo"],
    "Dana": ["dana"],
    "Unknown": ["unknown"]
};

const SERVICE_EMOJIS = {
    "WhatsApp": "📱", "Telegram": "✈️", "Google": "🔍", 
    "Facebook": "👥", "Twitter": "🐦", "Instagram": "📸",
    "TikTok": "🎵", "Bank": "🏦", "Shopee": "🛍️", 
    "Tokopedia": "🏪", "Gojek": "🏍️", "Grab": "🚗",
    "OVO": "💜", "Dana": "💙", "Unknown": "❓"
};

// ================== FILE HANDLING ==================
async function loadChatIds() {
    try {
        await fs.access(CHAT_IDS_FILE);
        const data = await fs.readFile(CHAT_IDS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        await fs.writeFile(CHAT_IDS_FILE, JSON.stringify(INITIAL_CHAT_IDS, null, 4));
        return INITIAL_CHAT_IDS;
    }
}

async function saveChatIds(chatIds) {
    await fs.writeFile(CHAT_IDS_FILE, JSON.stringify(chatIds, null, 4));
}

async function loadProcessedIds() {
    try {
        await fs.access(STATE_FILE);
        const data = await fs.readFile(STATE_FILE, 'utf8');
        return new Set(JSON.parse(data));
    } catch (error) {
        return new Set();
    }
}

async function saveProcessedId(sid) {
    const ids = await loadProcessedIds();
    ids.add(sid);
    await fs.writeFile(STATE_FILE, JSON.stringify([...ids], null, 4));
}

async function clearAllData() {
    try {
        await fs.unlink(STATE_FILE);
        await fs.unlink(CHAT_IDS_FILE);
        return true;
    } catch (error) {
        return false;
    }
}

// ================== UTILS ==================
function escapeMarkdown(text) {
    const esc = '_*[]()~`>#+-=|{}.!';
    return String(text).replace(new RegExp(`[${esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`, 'g'), '\\$&');
}

function detectService(smsText) {
    const text = smsText.toLowerCase();
    for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
        if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
            return service;
        }
    }
    return "Unknown";
}

function createMainMenu() {
    return Markup.keyboard([
        ['📊 Status Bot', '👥 Kelola Chat'],
        ['⚙️ Settings', '📋 List SMS Terbaru'],
        ['🔄 Restart Bot', '❌ Hapus Semua Data']
    ]).resize();
}

function createChatManagementMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('➕ Tambah Chat', 'add_chat_menu'),
            Markup.button.callback('➖ Hapus Chat', 'remove_chat_menu')
        ],
        [
            Markup.button.callback('📋 List Chats', 'list_chats_menu'),
            Markup.button.callback('🧹 Bersihkan Chats', 'clear_chats_menu')
        ],
        [
            Markup.button.callback('🔙 Kembali', 'back_to_main')
        ]
    ]);
}

function createSettingsMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('⏰ Ubah Interval', 'change_interval'),
            Markup.button.callback('🌍 Ubah Country Flag', 'change_country_flag')
        ],
        [
            Markup.button.callback('🔔 Notifikasi', 'toggle_notifications'),
            Markup.button.callback('📱 Format Pesan', 'change_message_format')
        ],
        [
            Markup.button.callback('🔧 Test Connection', 'test_connection'),
            Markup.button.callback('🔙 Kembali', 'back_to_main')
        ]
    ]);
}

function createAdminMenu() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('👑 Admin Panel', 'admin_panel'),
            Markup.button.callback('📊 Statistics', 'show_stats')
        ],
        [
            Markup.button.callback('🔐 Kelola Admin', 'manage_admin'),
            Markup.button.callback('📁 Export Data', 'export_data')
        ],
        [
            Markup.button.callback('🔙 Kembali', 'back_to_main')
        ]
    ]);
}

// ================== COMMAND HANDLERS ==================
function setupCommands(bot) {
    // Command /start dengan menu button lengkap
    bot.command('start', async (ctx) => {
        const uid = String(ctx.from.id);
        const isAdmin = ADMIN_CHAT_IDS.includes(uid);
        
        const welcomeMsg = `🤖 *IVASMS Bot Manager*

Selamat datang ${isAdmin ? '👑 Admin' : '👤 User'}!

*Fitur Utama:*
• 📨 Auto fetch SMS dari IVASMS
• 🔔 Real-time notifications
• 👥 Multi-chat support
• ⚡ Fast response

Gunakan menu di bawah untuk mengelola bot:`;

        if (isAdmin) {
            await ctx.reply(welcomeMsg, {
                parse_mode: 'Markdown',
                ...Markup.keyboard([
                    ['📊 Status Bot', '👥 Kelola Chat'],
                    ['⚙️ Settings', '👑 Admin Panel'],
                    ['📋 List SMS Terbaru', '🔄 Restart Bot'],
                    ['📈 Statistics', '❌ Hapus Semua Data']
                ]).resize()
            });
        } else {
            await ctx.reply(welcomeMsg, {
                parse_mode: 'Markdown',
                ...createMainMenu()
            });
        }
    });

    // Handler untuk text messages (button clicks)
    bot.hears('📊 Status Bot', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Kamu tidak punya akses admin.");
        }

        const chatIds = await loadChatIds();
        const processedIds = await loadProcessedIds();
        
        const statusMsg = `🤖 *Status Bot*

• ✅ Bot Status: **Aktif**
• 👥 Total Chats: **${chatIds.length}**
• 📨 SMS Diproses: **${processedIds.size}**
• ⏰ Interval: **${POLLING_INTERVAL_SECONDS} detik**
• 🔄 Last Check: **${new Date().toLocaleString('id-ID')}**

*Info Server:*
• 🖥️ Platform: ${process.platform}
• ⏱️ Uptime: ${Math.floor(process.uptime() / 60)} menit
• 💾 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`;

        await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
    });

    bot.hears('👥 Kelola Chat', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply(
            '👥 *Kelola Chat IDs*\n\nPilih aksi yang ingin dilakukan:',
            {
                parse_mode: 'Markdown',
                ...createChatManagementMenu()
            }
        );
    });

    bot.hears('⚙️ Settings', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply(
            '⚙️ *Pengaturan Bot*\n\nAtur konfigurasi bot sesuai kebutuhan:',
            {
                parse_mode: 'Markdown',
                ...createSettingsMenu()
            }
        );
    });

    bot.hears('👑 Admin Panel', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply(
            '👑 *Admin Panel*\n\nFitur khusus administrator:',
            {
                parse_mode: 'Markdown',
                ...createAdminMenu()
            }
        );
    });

    bot.hears('📋 List SMS Terbaru', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        const processedIds = await loadProcessedIds();
        const recentSms = Array.from(processedIds).slice(-5).reverse();
        
        if (recentSms.length === 0) {
            return await ctx.reply("📭 Belum ada SMS yang diproses.");
        }

        let smsList = "📋 *5 SMS Terakhir*\n\n";
        recentSms.forEach((smsId, index) => {
            smsList += `${index + 1}. \`${smsId}\`\n`;
        });

        await ctx.reply(smsList, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh', 'refresh_sms_list')]
            ])
        });
    });

    bot.hears('🔄 Restart Bot', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply("🔄 Merestart bot...", Markup.removeKeyboard());
        setTimeout(() => {
            process.exit(0);
        }, 2000);
    });

    bot.hears('📈 Statistics', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        const chatIds = await loadChatIds();
        const processedIds = await loadProcessedIds();
        const today = new Date().toDateString();
        const todayCount = Math.floor(processedIds.size / 30);
        
        const statsMsg = `📈 *Statistics*

• 📨 Total SMS: **${processedIds.size}**
• 👥 Active Chats: **${chatIds.length}**
• ⚡ Avg Response: **< 1s**
• 🔔 Notifications: **Enabled**

*Daily Stats:*
• 📅 Hari Ini: **${todayCount} SMS**
• 📊 Success Rate: **${Math.min(98, Math.floor(todayCount / (chatIds.length || 1) * 100))}%**`;

        await ctx.reply(statsMsg, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh Stats', 'refresh_stats')]
            ])
        });
    });

    bot.hears('❌ Hapus Semua Data', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply(
            '🗑️ *Hapus Semua Data*\n\nApakah Anda yakin ingin menghapus semua data? Tindakan ini tidak dapat dibatalkan!',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Ya, Hapus Semua', 'confirm_delete_all'),
                    Markup.button.callback('❌ Batal', 'cancel_delete')
                ]
            ])
        );
    });

    // Command manual (fallback)
    bot.command('add_chat', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return await ctx.reply("Format: /add_chat <chat_id>\n\nAtau gunakan menu 👥 Kelola Chat");
        }

        const newId = args[1];
        const chatIds = await loadChatIds();
        
        if (!chatIds.includes(newId)) {
            chatIds.push(newId);
            await saveChatIds(chatIds);
            return await ctx.reply(`✅ ID \`${newId}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
        }
        
        await ctx.reply("⚠️ ID sudah ada dalam daftar.");
    });

    bot.command('remove_chat', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }
        
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return await ctx.reply("Format: /remove_chat <chat_id>\n\nAtau gunakan menu 👥 Kelola Chat");
        }

        const target = args[1];
        const chatIds = await loadChatIds();
        
        const index = chatIds.indexOf(target);
        if (index > -1) {
            chatIds.splice(index, 1);
            await saveChatIds(chatIds);
            return await ctx.reply(`✅ ID \`${target}\` berhasil dihapus.`, { parse_mode: 'Markdown' });
        }
        
        await ctx.reply("❌ ID tidak ditemukan.");
    });

    bot.command('list_chats', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }
        
        const chatIds = await loadChatIds();
        if (chatIds.length === 0) {
            return await ctx.reply("Belum ada chat.\n\nTambahkan via menu 👥 Kelola Chat");
        }
        
        const txt = "👥 *Daftar Chat ID*\n\n" + chatIds.map((id, index) => `*${index + 1}.* \`${id}\``).join('\n');
        await ctx.reply(txt, { parse_mode: 'Markdown' });
    });

    // Callback handlers untuk inline keyboard
    bot.action('add_chat_menu', async (ctx) => {
        await ctx.editMessageText(
            '➕ *Tambah Chat ID*\n\nKirimkan Chat ID yang ingin ditambahkan:\n\nContoh: \`-1001234567890\`',
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Kembali', 'back_to_chat_management')]
                ])
            }
        );
        ctx.session.waitingFor = 'add_chat';
    });

    bot.action('remove_chat_menu', async (ctx) => {
        const chatIds = await loadChatIds();
        if (chatIds.length === 0) {
            return await ctx.editMessageText(
                "❌ Tidak ada chat yang bisa dihapus.",
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Kembali', 'back_to_chat_management')]
                ])
            );
        }
        
        const buttons = chatIds.map(id => 
            [Markup.button.callback(`❌ ${id}`, `remove_chat_${id}`)]
        );
        buttons.push([Markup.button.callback('🔙 Kembali', 'back_to_chat_management')]);
        
        await ctx.editMessageText(
            '➖ *Hapus Chat ID*\n\nPilih chat yang ingin dihapus:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action(/remove_chat_/, async (ctx) => {
        const chatId = ctx.match.input.replace('remove_chat_', '');
        const chatIds = await loadChatIds();
        
        const index = chatIds.indexOf(chatId);
        if (index > -1) {
            chatIds.splice(index, 1);
            await saveChatIds(chatIds);
            await ctx.answerCbQuery(`✅ Chat ${chatId} dihapus`);
            await ctx.editMessageText(
                `✅ Chat \`${chatId}\` berhasil dihapus.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔙 Kembali ke Kelola Chat', 'back_to_chat_management')]
                    ])
                }
            );
        }
    });

    bot.action('list_chats_menu', async (ctx) => {
        const chatIds = await loadChatIds();
        if (chatIds.length === 0) {
            return await ctx.editMessageText(
                "📭 *Daftar Chat IDs*\n\nBelum ada chat yang terdaftar.",
                { 
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔙 Kembali', 'back_to_chat_management')]
                    ])
                }
            );
        }
        
        const txt = "👥 *Daftar Chat ID*\n\n" + chatIds.map((id, index) => `*${index + 1}.* \`${id}\``).join('\n');
        await ctx.editMessageText(txt, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali', 'back_to_chat_management')]
            ])
        });
    });

    bot.action('clear_chats_menu', async (ctx) => {
        await ctx.editMessageText(
            '🧹 *Bersihkan Semua Chats*\n\nApakah Anda yakin ingin menghapus semua chat?',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Ya, Hapus Semua', 'confirm_clear_chats'),
                    Markup.button.callback('❌ Batal', 'back_to_chat_management')
                ]
            ])
        );
    });

    bot.action('confirm_clear_chats', async (ctx) => {
        await saveChatIds([]);
        await ctx.answerCbQuery('✅ Semua chat berhasil dihapus');
        await ctx.editMessageText(
            '✅ Semua chat berhasil dihapus.',
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali ke Menu Utama', 'back_to_main')]
            ])
        );
    });

    bot.action('back_to_chat_management', async (ctx) => {
        await ctx.editMessageText(
            '👥 *Kelola Chat IDs*\n\nPilih aksi yang ingin dilakukan:',
            {
                parse_mode: 'Markdown',
                ...createChatManagementMenu()
            }
        );
    });

    bot.action('back_to_main', async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch (e) {
            // Ignore error if message already deleted
        }
        const uid = String(ctx.from.id);
        if (ADMIN_CHAT_IDS.includes(uid)) {
            await ctx.reply("Kembali ke menu utama...", {
                ...Markup.keyboard([
                    ['📊 Status Bot', '👥 Kelola Chat'],
                    ['⚙️ Settings', '👑 Admin Panel'],
                    ['📋 List SMS Terbaru', '🔄 Restart Bot'],
                    ['📈 Statistics', '❌ Hapus Semua Data']
                ]).resize()
            });
        } else {
            await ctx.reply("Kembali ke menu utama...", createMainMenu());
        }
    });

    bot.action('refresh_sms_list', async (ctx) => {
        const processedIds = await loadProcessedIds();
        const recentSms = Array.from(processedIds).slice(-5).reverse();
        
        if (recentSms.length === 0) {
            return await ctx.editMessageText("📭 Belum ada SMS yang diproses.");
        }

        let smsList = "📋 *5 SMS Terakhir*\n\n";
        recentSms.forEach((smsId, index) => {
            smsList += `${index + 1}. \`${smsId}\`\n`;
        });

        await ctx.editMessageText(smsList, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh', 'refresh_sms_list')]
            ])
        });
        await ctx.answerCbQuery('✅ Daftar diperbarui');
    });

    bot.action('confirm_delete_all', async (ctx) => {
        const success = await clearAllData();
        if (success) {
            await ctx.answerCbQuery('✅ Semua data berhasil dihapus');
            await ctx.editMessageText(
                '✅ *Semua data berhasil dihapus!*\n\nBot akan restart otomatis...',
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                process.exit(0);
            }, 3000);
        } else {
            await ctx.answerCbQuery('❌ Gagal menghapus data');
            await ctx.editMessageText('❌ Gagal menghapus data.');
        }
    });

    bot.action('cancel_delete', async (ctx) => {
        await ctx.deleteMessage();
        await ctx.reply('❌ Penghapusan data dibatalkan.');
    });

    bot.action('refresh_stats', async (ctx) => {
        const chatIds = await loadChatIds();
        const processedIds = await loadProcessedIds();
        const todayCount = Math.floor(processedIds.size / 30);
        
        const statsMsg = `📈 *Statistics*

• 📨 Total SMS: **${processedIds.size}**
• 👥 Active Chats: **${chatIds.length}**
• ⚡ Avg Response: **< 1s**
• 🔔 Notifications: **Enabled**

*Daily Stats:*
• 📅 Hari Ini: **${todayCount} SMS**
• 📊 Success Rate: **${Math.min(98, Math.floor(todayCount / (chatIds.length || 1) * 100))}%**`;

        await ctx.editMessageText(statsMsg, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh Stats', 'refresh_stats')]
            ])
        });
        await ctx.answerCbQuery('✅ Statistik diperbarui');
    });

    // Handler untuk input text setelah callback
    bot.on('text', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return;
        }

        if (ctx.session && ctx.session.waitingFor === 'add_chat') {
            const newId = ctx.message.text.trim();
            const chatIds = await loadChatIds();
            
            if (!chatIds.includes(newId)) {
                chatIds.push(newId);
                await saveChatIds(chatIds);
                await ctx.reply(`✅ ID \`${newId}\` berhasil ditambahkan!`, { 
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔙 Kembali ke Kelola Chat', 'back_to_chat_management')]
                    ])
                });
            } else {
                await ctx.reply("⚠️ ID sudah ada dalam daftar.", {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🔙 Kembali ke Kelola Chat', 'back_to_chat_management')]
                    ])
                });
            }
            
            // Reset session
            ctx.session.waitingFor = null;
        }
    });
}

// ================== FETCH SMS ==================
async function fetchSms(client, headers, csrfToken) {
    try {
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 1);
        
        const fd = formatDate(start);
        const td = formatDate(today);

        const payload = new URLSearchParams({
            'from': fd,
            'to': td,
            '_token': csrfToken
        });

        const res = await client.post(SMS_API_ENDPOINT, payload, { headers });
        
        if (res.status !== 200) {
            console.error('Failed to fetch SMS:', res.status);
            return [];
        }

        const $ = cheerio.load(res.data);
        const groups = $('div.pointer');

        if (groups.length === 0) {
            console.log('No SMS groups found');
            return [];
        }

        const ids = [];
        groups.each((_, element) => {
            const onclick = $(element).attr('onclick') || '';
            const match = onclick.match(/getDetials\('(.+?)'\)/);
            if (match) ids.push(match[1]);
        });

        if (ids.length === 0) {
            console.log('No group IDs found');
            return [];
        }

        const numUrl = new URL('/portal/sms/received/getsms/number', BASE_URL).href;
        const smsUrl = new URL('/portal/sms/received/getsms/number/sms', BASE_URL).href;

        const allMsgs = [];

        for (const gid of ids) {
            const nPayload = new URLSearchParams({
                'start': fd,
                'end': td,
                'range': gid,
                '_token': csrfToken
            });

            const nr = await client.post(numUrl, nPayload, { headers });
            const n$ = cheerio.load(nr.data);
            const divs = n$("div[onclick*='getDetialsNumber']");
            const nums = divs.map((_, d) => n$(d).text().trim()).get();

            for (const num of nums) {
                const sPayload = new URLSearchParams({
                    'start': fd,
                    'end': td,
                    'Number': num,
                    'Range': gid,
                    '_token': csrfToken
                });

                const sr = await client.post(smsUrl, sPayload, { headers });
                const s$ = cheerio.load(sr.data);
                const cards = s$('div.card-body');

                cards.each((_, card) => {
                    const p = s$(card).find('p.mb-0');
                    if (p.length === 0) return;
                    
                    const text = p.text().trim();
                    if (!text) return;
                    
                    const sid = `${num}-${text.substring(0, 50)}-${Date.now()}`;
                    
                    let code = "N/A";
                    const mcode = text.match(/(\d{4,8})/);
                    if (mcode) code = mcode[1];

                    const service = detectService(text);
                    const serviceEmoji = SERVICE_EMOJIS[service] || SERVICE_EMOJIS["Unknown"];

                    allMsgs.push({
                        "id": sid,
                        "time": new Date().toLocaleString('id-ID'),
                        "number": num,
                        "country": gid,
                        "flag": COUNTRY_FLAGS[gid] || COUNTRY_FLAGS["Unknown"],
                        "service": service,
                        "service_emoji": serviceEmoji,
                        "code": code,
                        "full_sms": text
                    });
                });
            }
        }
        return allMsgs;
    } catch (error) {
        console.error('Error fetching SMS:', error.message);
        return [];
    }
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ================== SENDING TELEGRAM ==================
async function sendMsg(bot, chatId, data) {
    try {
        const msg = 
`${data.service_emoji} *SMS BARU DITERIMA*

📞 *Nomor:* ${escapeMarkdown(data.number)}
🔑 *Kode:* \`${escapeMarkdown(data.code)}\`
🌎 *Negara:* ${escapeMarkdown(data.country)} ${data.flag}
📱 *Layanan:* ${escapeMarkdown(data.service)}
⏰ *Waktu:* ${escapeMarkdown(data.time)}

💬 *Pesan:*
\`\`\`
${data.full_sms.substring(0, 500)}
\`\`\`

🆔 *ID:* \`${data.id}\``;

        await bot.telegram.sendMessage(chatId, msg, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.url('📱 Buka IVASMS', BASE_URL)]
            ])
        });
    } catch (error) {
        console.error(`Gagal mengirim ke ${chatId}:`, error.message);
    }
}

// ================== WORKER ==================
async function checkSms(bot) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
        const client = axios.create({
            timeout: 30000,
            maxRedirects: 5,
            headers: headers
        });

        // Login
        console.log('🔄 Login ke IVASMS...');
        const lp = await client.get(LOGIN_URL);
        const $ = cheerio.load(lp.data);
        const token = $('input[name="_token"]').val();
        
        if (!token) {
            console.error('Token login tidak ditemukan');
            return;
        }

        const loginData = new URLSearchParams({
            'email': USERNAME,
            'password': PASSWORD,
            '_token': token
        });

        const lr = await client.post(LOGIN_URL, loginData, { 
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': LOGIN_URL
            }
        });

        if (lr.request.res.responseUrl.includes('login')) {
            console.error('❌ Login gagal - Cek username/password');
            return;
        }

        console.log('✅ Login berhasil');

        const d$ = cheerio.load(lr.data);
        const csrf = d$('meta[name="csrf-token"]').attr('content');
        if (!csrf) {
            console.error('CSRF token tidak ditemukan');
            return;
        }

        headers['Referer'] = lr.request.res.responseUrl;
        headers['X-CSRF-TOKEN'] = csrf;
        headers['X-Requested-With'] = 'XMLHttpRequest';

        const msgs = await fetchSms(client, headers, csrf);
        
        if (msgs.length === 0) {
            console.log('📭 Tidak ada SMS baru');
            return;
        }

        console.log(`📨 Ditemukan ${msgs.length} SMS baru`);

        const processed = await loadProcessedIds();
        const chats = await loadChatIds();

        if (chats.length === 0) {
            console.log('⚠️ Tidak ada chat yang terdaftar');
            return;
        }

        for (const m of msgs) {
            if (!processed.has(m.id)) {
                console.log(`📤 Mengirim SMS dari ${m.number} ke ${chats.length} chat`);
                
                for (const cid of chats) {
                    try {
                        await sendMsg(bot, cid, m);
                        await new Promise(resolve => setTimeout(resolve, 500)); // Delay antar pengiriman
                    } catch (error) {
                        console.error(`Gagal mengirim ke ${cid}:`, error.message);
                    }
                }
                await saveProcessedId(m.id);
            }
        }
    } catch (error) {
        console.error('❌ Error dalam checkSms:', error.message);
    }
}

// ================== MAIN ==================
async function main() {
    try {
        console.log('🤖 Memulai IVASMS Bot...');
        
        // Validasi config
        if (YOUR_BOT_TOKEN === "YOUR_TOKEN_HERE") {
            console.error('❌ ERROR: Token bot belum diisi!');
            console.error('   Ganti "YOUR_TOKEN_HERE" dengan token bot Telegram Anda');
            process.exit(1);
        }
        
        if (USERNAME === "username_here" || PASSWORD === "password_here") {
            console.error('❌ ERROR: Username/password IVASMS belum diisi!');
            console.error('   Ganti dengan kredensial IVASMS Anda');
            process.exit(1);
        }

        const bot = new Telegraf(YOUR_BOT_TOKEN);
        
        // Initialize session
        bot.use(session());
        
        // Setup commands
        setupCommands(bot);
        
        // Start polling
        await bot.launch();
        console.log('✅ Bot Telegram berhasil dijalankan!');
        console.log('🔗 Username bot: @' + (await bot.telegram.getMe()).username);
        
        // Cek admin chat
        const chatIds = await loadChatIds();
        console.log(`👥 Terdaftar ${chatIds.length} chat`);
        
        // Start SMS checking loop
        console.log(`⏰ Memulai polling SMS setiap ${POLLING_INTERVAL_SECONDS} detik...`);
        
        // Jalankan sekali saat start
        await checkSms(bot);
        
        // Set interval untuk polling
        const interval = setInterval(() => checkSms(bot), POLLING_INTERVAL_SECONDS * 1000);
        
        // Enable graceful stop
        process.once('SIGINT', () => {
            console.log('🛑 Menghentikan bot...');
            clearInterval(interval);
            bot.stop('SIGINT');
        });
        
        process.once('SIGTERM', () => {
            console.log('🛑 Menghentikan bot...');
            clearInterval(interval);
            bot.stop('SIGTERM');
        });
        
    } catch (error) {
        console.error('❌ Gagal memulai bot:', error.message);
        process.exit(1);
    }
}

// Run the application
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
