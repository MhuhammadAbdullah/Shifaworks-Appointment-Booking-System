# Email delivery: kya masla tha aur kaise theek karna hai

## Masla (production database ke asli email logs se)
16 Oct (Pakistan time) ko booking ki **22 emails fail** hui, ek bhi sent nahi hui. Har error ya to
`SMTP: Connection timeout` tha ya `connect ENETUNREACH 2404:6800:...:587` (Google ka IPv6 address).

- Server ne `smtp.gmail.com:587` tak connection hi nahi khola. Yeh Gmail ka password/settings ka masla **nahi** hai.
- Aap ke computer se wahi SMTP chalta hai (14 Oct ko wahan se 40 emails sent hui). Sirf **Render** par fail hota hai.
- Wajah: Render apne servers par outbound SMTP ports **25, 465 aur 587 band** rakhta hai (free instances par).
  Is liye har koshish timeout hoti hai, aur 5 koshish ke baad email "FAILED" ho jati hai.

Matlab: Gmail SMTP Render par kabhi nahi chalega. Code mein koi galti nahi, setup badalna parega.

## Is ka asar
Un customers ko jinki booking 16 Oct ko aayi, **"Booking received" aur payment ki details wali email nahi gayi**, aur admin
ko bhi "new booking" ki email nahi mili. Email log mein 12 aisi notifications FAILED hain. Setup theek hone ke baad inhein
dobara bhejna hai (neeche Step 4).

## Hal: email ko SMTP se HTTPS API par le jayen (Resend)
Code mein Resend pehle se maujood hai (`EMAIL_PROVIDER=resend`). Yeh HTTPS (port 443) par chalta hai jo Render band nahi karta.

### Step 1: Resend mein domain verify karein (aap ko karna hai)
1. https://resend.com par account banayein / login karein. **Domains → Add Domain** → `shifaworks.com`.
2. Resend DNS records dikhayega (SPF, DKIM, aur ek MX/return-path). Un ko apne domain ke DNS mein add karein
   (jahan `shifaworks.com` ka DNS manage hota hai: GoDaddy, Namecheap, Cloudflare, ya hosting panel).
3. Resend mein **Verify** dabayein. Status "Verified" hone mein kuch minute se kuch ghante lag sakte hain.
4. **API Keys → Create API Key** (Sending access) aur key copy karein. Yeh key kisi ko na dikhayein.

Zaroori: Gmail ke address (`shifaworksofficial@gmail.com`) se Resend nahi bhej sakta. Bhejne wala address apne verified
domain ka hona chahiye, jaise `no-reply@shifaworks.com`.

### Step 2: Render ke environment variables badlein (aap ko karna hai)
Render dashboard → API service → **Environment**:

| Variable | Nayi value |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | wo key jo Step 1 mein copy ki |
| `EMAIL_FROM` | `ShifaWorks <no-reply@shifaworks.com>` |
| `EMAIL_REPLY_TO` | `contact@shifaworks.com` (pehle jaisa) |

Purane `SMTP_*` variables rehne dein, sirf `EMAIL_PROVIDER` badalne se woh istemal nahi hote. Save karein, service redeploy hone dein.

### Step 3: Test karein
Dashboard → Settings / Email templates mein **send test** se apne apne address par ek email bhejein. Email aani chahiye.
Agar nahi aati to Admin → Email log mein us ki entry kholein: ab error saaf likha aayega (jaise unverified domain).

### Step 4: Jo 12 emails fail hui thin unhein dobara bhejein
Admin → **Email log** → upar **"Retry failed emails"** button (pichle 30 din ki failed emails dobara queue hoti hain).
Ya har email kholkar **Retry** dabayein. Yeh sirf tab karein jab Step 3 ka test kaam kar chuka ho.

## Agar Resend na chalana ho
- **SMTP relay jo port 2525 deta hai** (Brevo, Mailgun, SendGrid): `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT=2525`,
  `SMTP_USER`, `SMTP_PASS`, aur bhejne wala address un ke yahan verify ho. Render 2525 band nahi karta.
- **Render ka paid instance**: wahan outbound SMTP khula hota hai, to Gmail SMTP chal sakta hai.
  (Gmail ke liye App Password aur 2-step verification chahiye.) Gmail ki bhejne ki limit chhoti hoti hai, isliye business emails ke liye kam munasib hai.

## Code mein kya badla
- SMTP ka timeout/unreachable error ab saaf likhta hai: "yeh server SMTP port nahi khol sakta ... Resend ya port 2525 istemal karein", pehle sirf "Connection timeout" likha aata tha.
- Email log mein **Retry failed emails** ka naya button (aur `POST /notifications/retry-failed`).
- Tests: error ke alfaaz ke liye 4 unit tests, aur retry ke liye 2 integration tests.
