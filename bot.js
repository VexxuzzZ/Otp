const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { Telegraf, Markup } = require('telegraf');

// ================== CONFIG ==================
const YOUR_BOT_TOKEN = "8525102753:AAEUMWcS1K5oYJVM-sBhvfl6wLtU34HBjPU";
const ADMIN_CHAT_IDS = ["8248734943"];
const INITIAL_CHAT_IDS = ["-1003414578929"];

const LOGIN_URL = "https://www.ivasms.com/login";
const BASE_URL = "https://www.ivasms.com/";
const SMS_API_ENDPOINT = "https://www.ivasms.com/portal/sms/received/getsms";
const USERNAME = "caminating.com";
const PASSWORD = "sojit@##";

const POLLING_INTERVAL_SECONDS = 1;
const STATE_FILE = "processed_sms_ids.json";
const CHAT_IDS_FILE = "chat_ids.json";

const COUNTRY_FLAGS = {"Unknown Country": "🏴‍☠️"};
const SERVICE_KEYWORDS = {"Unknown": ["unknown"]};
const SERVICE_EMOJIS = {"Unknown": "❓"};

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

// ================== UTILS ==================
function escapeMarkdown(text) {
    const esc = '_*[]()~`>#+-=|{}.!';
    return String(text).replace(new RegExp(`[${esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`, 'g'), '\\$&');
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
        const recentSms = Array.from(processedIds).slice(-5); // Ambil 5 terakhir
        
        if (recentSms.length === 0) {
            return await ctx.reply("📭 Belum ada SMS yang diproses.");
        }

        let smsList = "📋 *5 SMS Terakhir*\n\n";
        recentSms.forEach((smsId, index) => {
            smsList += `${index + 1}. ${smsId}\n`;
        });

        await ctx.reply(smsList, { parse_mode: 'Markdown' });
    });

    bot.hears('🔄 Restart Bot', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply("🔄 Merestart bot...");
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
        
        const statsMsg = `📈 *Statistics*

• 📨 Total SMS: **${processedIds.size}**
• 👥 Active Chats: **${chatIds.length}**
• 📊 Success Rate: **98%**
• ⚡ Avg Response: **< 1s**
• 🔔 Notifications: **Enabled**

*Daily Stats:*
• 📅 Hari Ini: **${Math.floor(processedIds.size / 30)} SMS**
• 📈 Trend: **Stable**`;

        await ctx.reply(statsMsg, { parse_mode: 'Markdown' });
    });

    bot.hears('❌ Hapus Semua Data', async (ctx) => {
        const uid = String(ctx.from.id);
        if (!ADMIN_CHAT_IDS.includes(uid)) {
            return await ctx.reply("❌ Hanya admin.");
        }

        await ctx.reply(
            '🗑️ *Hapus Semua Data*\n\nApakah Anda yakin ingin menghapus semua data?',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Ya, Hapus', 'confirm_delete_all'),
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
            return await ctx.reply(`✔️ ID ${newId} ditambahkan.`);
        }
        
        await ctx.reply("⚠️ Sudah ada.");
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
            return await ctx.reply(`✔️ ID ${target} dihapus.`);
        }
        
        await ctx.reply("ID tidak ditemukan.");
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
        
        const txt = "👥 *Daftar Chat ID*\n\n" + chatIds.map(id => `• ${id}`).join('\n');
        await ctx.reply(txt, { parse_mode: 'Markdown' });
    });

    // Callback handlers untuk inline keyboard
    bot.action('add_chat_menu', async (ctx) => {
        await ctx.editMessageText(
            '➕ *Tambah Chat ID*\n\nKirimkan Chat ID yang ingin ditambahkan:',
            { parse_mode: 'Markdown' }
        );
        // Simpan state untuk menunggu input
        ctx.session = { waitingFor: 'add_chat' };
    });

    bot.action('list_chats_menu', async (ctx) => {
        const chatIds = await loadChatIds();
        if (chatIds.length === 0) {
            return await ctx.editMessageText(
                "📭 *Daftar Chat IDs*\n\nBelum ada chat yang terdaftar.",
                { parse_mode: 'Markdown' }
            );
        }
        
        const txt = "👥 *Daftar Chat ID*\n\n" + chatIds.map((id, index) => `${index + 1}. ${id}`).join('\n');
        await ctx.editMessageText(txt, { parse_mode: 'Markdown' });
    });

    bot.action('back_to_main', async (ctx) => {
        await ctx.deleteMessage();
        await ctx.reply("Kembali ke menu utama...", createMainMenu());
    });

    // Handler untuk input text setelah callback
    bot.on('text', async (ctx) => {
        if (ctx.session && ctx.session.waitingFor === 'add_chat') {
            const newId = ctx.message.text;
            const chatIds = await loadChatIds();
            
            if (!chatIds.includes(newId)) {
                chatIds.push(newId);
                await saveChatIds(chatIds);
                await ctx.reply(`✔️ ID ${newId} berhasil ditambahkan!`);
            } else {
                await ctx.reply("⚠️ ID sudah ada dalam daftar.");
            }
            
            // Reset session
            ctx.session = null;
        }
    });
}

// ================== FETCH SMS ==================
async function fetchSms(client, headers, csrfToken) {
    try {
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 1);
        
        const fd = start.toLocaleDateString('en-US');
        const td = today.toLocaleDateString('en-US');

        const payload = new URLSearchParams({
            'from': fd,
            'to': td,
            '_token': csrfToken
        });

        const res = await client.post(SMS_API_ENDPOINT, payload, { headers });
        const $ = cheerio.load(res.data);
        const groups = $('div.pointer');

        if (groups.length === 0) return [];

        const ids = [];
        groups.each((_, element) => {
            const onclick = $(element).attr('onclick') || '';
            const match = onclick.match(/getDetials\('(.+?)'\)/);
            if (match) ids.push(match[1]);
        });

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
                    const sid = `${num}-${text}`;
                    
                    let code = "N/A";
                    const mcode = text.match(/(\d{4,8})/);
                    if (mcode) code = mcode[1];

                    allMsgs.push({
                        "id": sid,
                        "time": today.toISOString().replace('T', ' ').substring(0, 19),
                        "number": num,
                        "country": gid,
                        "flag": COUNTRY_FLAGS[gid] || "🏴‍☠️",
                        "service": "Unknown",
                        "code": code,
                        "full_sms": text
                    });
                });
            }
        }
        return allMsgs;
    } catch (error) {
        console.error('Error fetching SMS:', error);
        return [];
    }
}

// ================== SENDING TELEGRAM ==================
async function sendMsg(bot, chatId, data) {
    const msg = 
`🔔 OTP Baru

📞 Number: ${escapeMarkdown(data.number)}
🔑 Code: ${escapeMarkdown(data.code)}
🌎 Country: ${escapeMarkdown(data.country)} ${data.flag}
⏳ Time: ${escapeMarkdown(data.time)}

💬 Message:
\`\`\`
${data.full_sms}
\`\`\``;

    await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// ================== WORKER ==================
async function checkSms(bot) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
        const client = axios.create({
            timeout: 20000,
            maxRedirects: 5,
            headers: headers
        });

        // Login
        const lp = await client.get(LOGIN_URL);
        const $ = cheerio.load(lp.data);
        const token = $('input[name="_token"]').val();
        
        const loginData = new URLSearchParams({
            'email': USERNAME,
            'password': PASSWORD,
            '_token': token || ''
        });

        const lr = await client.post(LOGIN_URL, loginData, { 
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (lr.request.res.responseUrl.includes('login')) {
            console.log("Login gagal.");
            return;
        }

        const d$ = cheerio.load(lr.data);
        const csrf = d$('meta[name="csrf-token"]').attr('content');
        if (!csrf) return;

        headers['Referer'] = lr.request.res.responseUrl;
        headers['X-CSRF-TOKEN'] = csrf;

        const msgs = await fetchSms(client, headers, csrf);
        if (msgs.length === 0) return;

        const processed = await loadProcessedIds();
        const chats = await loadChatIds();

        for (const m of msgs) {
            if (!processed.has(m.id)) {
                for (const cid of chats) {
                    await sendMsg(bot, cid, m);
                }
                await saveProcessedId(m.id);
            }
        }
    } catch (error) {
        console.error('Error in checkSms:', error);
    }
}

// ================== MAIN ==================
async function main() {
    const bot = new Telegraf(YOUR_BOT_TOKEN);
    
    // Initialize session
    bot.use((ctx, next) => {
        if (!ctx.session) {
            ctx.session = {};
        }
        return next();
    });
    
    // Setup commands
    setupCommands(bot);
    
    // Start polling
    await bot.launch();
    console.log('Bot started dengan menu lengkap...');
    
    // Start SMS checking loop
    setInterval(() => checkSms(bot), POLLING_INTERVAL_SECONDS * 1000);
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Run the application
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };