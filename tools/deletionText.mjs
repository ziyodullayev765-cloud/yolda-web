/**
 * Akkauntni o'chirish sahifasining matni.
 *
 * Google Play 2024-yildan beri shuni talab qiladi: akkaunt
 * yaratiladigan ilovada o'chirish ilovaning ichida ham, OCHIQ
 * manzilda ham bo'lishi kerak — ya'ni ilovani o'rnatmagan yoki
 * o'chirib tashlagan odam ham so'rov yubora olsin.
 *
 * Bu yerdagi har bir gap `lib/deleteAccount.js` ga qarab yozilgan.
 * Agar o'sha fayldagi xulq o'zgarsa — masalan yangi kalit qo'shilsa
 * yoki anonim qilish tartibi boshqacha bo'lsa — shu matn ham
 * yangilanishi kerak. Va'da qilib bajarilmaydigan gap bu yerda
 * bo'lmasligi lozim.
 */

export const HEADINGS = {
  uz: "Akkauntni o'chirish",
  ru: 'Удаление аккаунта',
  en: 'Deleting your account',
};

export const BODIES = {
  uz:
    "<p>YO'LDA (dasturchi: Ziyodullayev, paket nomi <b>uz.yolda.app</b>) akkauntingizni va unga bog'liq ma'lumotlarni o'chirish tartibi quyida yozilgan.</p>"

    + "<h4>1. Ilovaning o'zida o'chirish</h4>"
    + "<p>Eng tez yo'l — ilovaning ichidan. Hech kimga yozish va javob kutish kerak emas:</p>"
    + '<ol>'
    + "<li>YO'LDA ilovasini oching va hisobingizga kiring.</li>"
    + "<li>Pastdagi panelda <b>Profil</b> bo'limiga o'ting.</li>"
    + "<li>Sahifaning eng pastida <b>Akkauntni o'chirish</b> tugmasini bosing.</li>"
    + "<li>Nima o'chishini o'qing va tasdiqlash uchun username'ingizni yozing.</li>"
    + "<li><b>Akkauntni butunlay o'chirish</b> tugmasini bosing.</li>"
    + '</ol>'
    + "<p>O'chirish <b>darhol</b> bajariladi — kutish muddati yo'q va bekor qilib bo'lmaydi.</p>"

    + "<h4>2. Ilovasiz so'rov yuborish</h4>"
    + "<p>Ilovani o'chirib tashlagan yoki hisobingizga kira olmayotgan bo'lsangiz, bizga yozing:</p>"
    + '<ul>'
    + '<li>Telegram: <a href="https://t.me/ziyodullayv" rel="noopener">@ziyodullayv</a></li>'
    + '<li>Telefon: +998 94 440 20 90</li>'
    + '</ul>'
    + "<p>Hisobingizni aniqlashimiz uchun ro'yxatdan o'tgan telefon raqamingizni yoki username'ingizni yuboring. So'rovni <b>7 kun ichida</b> bajaramiz.</p>"

    + "<h4>3. Nima butunlay o'chadi</h4>"
    + '<ul>'
    + "<li>Profilingiz: ism, username, shahar, rol, mashina ma'lumotlari, o'zingiz haqingizdagi matn</li>"
    + '<li>Avatar rasmingiz (fayl saqlagichdan ham o\'chiriladi)</li>'
    + "<li>Tasdiqlash hujjatlari: pasport, haydovchilik guvohnomasi yoki texnik pasport rasmlari</li>"
    + "<li>Telefon raqamingiz va Telegram hisobingiz bilan bog'lanish</li>"
    + "<li>Saqlangan qidiruvlar va ularga keladigan xabarlar</li>"
    + "<li>Bildirishnomalaringiz, saralangan e'lonlar va saqlangan haydovchilar</li>"
    + "<li>Yozishmalar ro'yxatingiz va o'qilmagan xabarlar hisobi</li>"
    + '<li>Yuborgan takliflaringiz</li>'
    + '</ul>'

    + "<h4>4. Nima qoladi — va nega</h4>"
    + "<p>Ma'lumotning bir qismi yolg'iz sizniki emas: tugagan buyurtma — ikki odam o'rtasidagi kelishuv yozuvi, yozishmaning esa ikkita egasi bor. Ularni butunlay o'chirish ikkinchi tomonning tarixini buzadi.</p>"
    + '<ul>'
    + "<li><b>Buyurtmalar tarixi</b> qoladi, lekin <b>ismingiz, telefoningiz va username'ingiz olib tashlanadi</b> — yozuvda faqat yo'nalish, sana va holat qoladi. Hali hech kim olmagan yuklaringiz bekor qilinadi.</li>"
    + "<li><b>Mashina e'lonlaringiz</b> sotuvdan olinadi va ulardan ham ism bilan telefon o'chiriladi.</li>"
    + "<li><b>Xabarlar matni</b> suhbatdoshingizda qoladi — xuddi siz yuborgan SMS uning telefonida qolgani kabi. Sizda esa yozishmalar ro'yxati qolmaydi.</li>"
    + "<li><b>Boshqalarga qo'ygan baholaringiz</b> ularning profilida qoladi: bu ular haqidagi ma'lumot.</li>"
    + "<li><b>Username'ingiz</b> boshqa odamga berilmaydi. Aks holda siz qoldirgan baholar yangi egasiniki bo'lib ko'rinardi.</li>"
    + '</ul>'
    + "<p>Agar hisobingiz qoidabuzarlik uchun cheklangan bo'lsa, cheklov saqlanadi — akkauntni o'chirib qayta ro'yxatdan o'tish bilan undan qutulib bo'lmaydi.</p>"

    + "<h4>5. Qachon o'chira olmaysiz</h4>"
    + "<p>Hozir <b>yo'lda ketayotgan yukingiz</b> bo'lsa, o'chirish to'xtatiladi va buning sababi aytiladi. Yuk yetkazilmagan bo'lsa, ikkinchi tomon siz bilan bog'lana olishi kerak. Buyurtma yakunlangach o'chirish yana ochiladi.</p>"

    + '<h4>6. Server jurnallari</h4>'
    + "<p>Sayt joylashgan xizmat (Vercel) so'rovlar jurnalida IP manzil va brauzer ma'lumotini vaqtincha saqlaydi. Bu jurnallar akkauntga bog'lanmagan va o'z muddati bilan o'chadi.</p>",

  ru:
    "<p>Ниже описан порядок удаления аккаунта YO'LDA (разработчик: Ziyodullayev, имя пакета <b>uz.yolda.app</b>) и связанных с ним данных.</p>"

    + '<h4>1. Удаление в самом приложении</h4>'
    + '<p>Самый быстрый способ — прямо в приложении. Никому писать и ждать ответа не нужно:</p>'
    + '<ol>'
    + "<li>Откройте приложение YO'LDA и войдите в аккаунт.</li>"
    + '<li>В нижней панели перейдите в раздел <b>Профиль</b>.</li>'
    + '<li>В самом низу страницы нажмите <b>Удалить аккаунт</b>.</li>'
    + '<li>Прочитайте, что будет удалено, и введите свой username для подтверждения.</li>'
    + '<li>Нажмите <b>Удалить аккаунт полностью</b>.</li>'
    + '</ol>'
    + '<p>Удаление выполняется <b>сразу</b> — периода ожидания нет, отменить нельзя.</p>'

    + '<h4>2. Запрос без приложения</h4>'
    + '<p>Если вы удалили приложение или не можете войти в аккаунт, напишите нам:</p>'
    + '<ul>'
    + '<li>Telegram: <a href="https://t.me/ziyodullayv" rel="noopener">@ziyodullayv</a></li>'
    + '<li>Телефон: +998 94 440 20 90</li>'
    + '</ul>'
    + '<p>Чтобы мы нашли ваш аккаунт, укажите номер телефона, на который он зарегистрирован, или ваш username. Запрос выполняем <b>в течение 7 дней</b>.</p>'

    + '<h4>3. Что удаляется полностью</h4>'
    + '<ul>'
    + '<li>Профиль: имя, username, город, роль, данные о машине, текст о себе</li>'
    + '<li>Фото аватара (удаляется и из файлового хранилища)</li>'
    + '<li>Документы верификации: фото паспорта, водительского удостоверения или техпаспорта</li>'
    + '<li>Привязка номера телефона и Telegram-аккаунта</li>'
    + '<li>Сохранённые поиски и уведомления по ним</li>'
    + '<li>Ваши уведомления, избранные объявления и сохранённые водители</li>'
    + '<li>Список переписок и счётчики непрочитанных сообщений</li>'
    + '<li>Отправленные вами предложения</li>'
    + '</ul>'

    + '<h4>4. Что остаётся — и почему</h4>'
    + '<p>Часть данных принадлежит не только вам: завершённый заказ — это запись договорённости двух людей, а у переписки два владельца. Полное удаление разрушило бы историю второй стороны.</p>'
    + '<ul>'
    + '<li><b>История заказов</b> остаётся, но <b>имя, телефон и username удаляются</b> — в записи остаются только маршрут, дата и статус. Грузы, которые ещё никто не взял, отменяются.</li>'
    + '<li><b>Объявления о машинах</b> снимаются с продажи, имя и телефон из них тоже удаляются.</li>'
    + '<li><b>Текст сообщений</b> остаётся у собеседника — так же, как отправленное вами SMS остаётся в его телефоне. У вас списка переписок не остаётся.</li>'
    + '<li><b>Оценки, которые вы поставили другим</b>, остаются в их профилях: это данные о них.</li>'
    + '<li><b>Ваш username</b> не передаётся другому человеку. Иначе оставленные вами оценки выглядели бы как оценки нового владельца.</li>'
    + '</ul>'
    + '<p>Если аккаунт был ограничен за нарушение правил, ограничение сохраняется — обойти его удалением и повторной регистрацией нельзя.</p>'

    + '<h4>5. Когда удалить нельзя</h4>'
    + '<p>Если прямо сейчас у вас есть <b>груз в пути</b>, удаление останавливается и вам объясняют причину. Пока груз не доставлен, вторая сторона должна иметь возможность с вами связаться. После завершения заказа удаление снова доступно.</p>'

    + '<h4>6. Журналы сервера</h4>'
    + '<p>Хостинг (Vercel) временно хранит IP-адрес и данные браузера в журнале запросов. Эти журналы не привязаны к аккаунту и удаляются по истечении своего срока.</p>',

  en:
    "<p>This page explains how to delete your YO'LDA account (developer: Ziyodullayev, package name <b>uz.yolda.app</b>) and the data attached to it.</p>"

    + '<h4>1. Deleting from inside the app</h4>'
    + '<p>The fastest way is in the app itself. You do not have to write to anyone or wait for a reply:</p>'
    + '<ol>'
    + "<li>Open the YO'LDA app and sign in.</li>"
    + '<li>Go to <b>Profile</b> in the bottom bar.</li>'
    + '<li>At the very bottom of the page, tap <b>Delete account</b>.</li>'
    + '<li>Read what will be deleted, then type your username to confirm.</li>'
    + '<li>Tap <b>Delete account permanently</b>.</li>'
    + '</ol>'
    + '<p>Deletion happens <b>immediately</b> — there is no waiting period and it cannot be undone.</p>'

    + '<h4>2. Requesting deletion without the app</h4>'
    + '<p>If you have uninstalled the app or cannot sign in, contact us:</p>'
    + '<ul>'
    + '<li>Telegram: <a href="https://t.me/ziyodullayv" rel="noopener">@ziyodullayv</a></li>'
    + '<li>Phone: +998 94 440 20 90</li>'
    + '</ul>'
    + '<p>So we can find your account, send the phone number it is registered to, or your username. We act on the request <b>within 7 days</b>.</p>'

    + '<h4>3. What is deleted outright</h4>'
    + '<ul>'
    + '<li>Your profile: name, username, city, role, vehicle details, bio</li>'
    + '<li>Your avatar image (removed from file storage as well)</li>'
    + '<li>Verification documents: photos of an ID, driving licence or vehicle registration</li>'
    + '<li>The link between your account and your phone number and Telegram account</li>'
    + '<li>Saved searches and the alerts they send</li>'
    + '<li>Your notifications, saved listings and saved drivers</li>'
    + '<li>Your conversation list and unread counters</li>'
    + '<li>Offers you have sent</li>'
    + '</ul>'

    + '<h4>4. What is kept — and why</h4>'
    + '<p>Some records do not belong to you alone: a completed order is the record of an agreement between two people, and a conversation has two owners. Erasing them outright would destroy the other side\'s history.</p>'
    + '<ul>'
    + '<li><b>Order history</b> is kept, but <b>your name, phone number and username are stripped from it</b> — only the route, date and status remain. Loads nobody has taken yet are cancelled.</li>'
    + '<li><b>Your vehicle listings</b> are withdrawn from sale, and the name and phone number are removed from them too.</li>'
    + '<li><b>The text of your messages</b> stays with the person you wrote to — just as an SMS you sent stays on their phone. You keep no conversation list.</li>'
    + '<li><b>Ratings you left for others</b> stay on their profiles: that is information about them.</li>'
    + '<li><b>Your username</b> is not handed to anyone else. Otherwise the ratings you left would appear to come from its new owner.</li>'
    + '</ul>'
    + '<p>If your account was restricted for breaking the rules, the restriction stays — deleting and re-registering does not get around it.</p>'

    + '<h4>5. When deletion is blocked</h4>'
    + '<p>If you have a <b>load in transit</b> right now, deletion stops and you are told why. Until the load is delivered, the other party has to be able to reach you. Once the order is finished, deletion is available again.</p>'

    + '<h4>6. Server logs</h4>'
    + '<p>Our host (Vercel) keeps IP address and browser details in its request logs for a limited time. Those logs are not tied to an account and expire on their own schedule.</p>',
};
