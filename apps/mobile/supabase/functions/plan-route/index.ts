import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { region, days, budget, interests, groupType, pois } = body;

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'API key tapılmadı' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    const restaurants = pois?.restaurants || [];
    const accommodations = pois?.accommodations || [];
    const attractions = pois?.attractions || [];

    const allPois = [...restaurants, ...accommodations, ...attractions];

    if (allPois.length === 0) {
      return new Response(JSON.stringify({ error: 'Bu bölgədə yer tapılmadı' }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    const userPrompt = `
Region: ${body.region}
Gün sayı: ${body.days}
Büdcə: ${body.budget}
Maraqlar: ${Array.isArray(body.interests) ? body.interests.join(', ') : body.interests}
Qrup: ${body.groupType}

MÖVCUD RESTORANLAR/KAFELER:
${JSON.stringify(
  (body.pois?.restaurants || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    lat: p.lat,
    lng: p.lng,
  }))
)}

MÖVCUD QALMA YERLƏRİ:
${JSON.stringify(
  (body.pois?.accommodations || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    lat: p.lat,
    lng: p.lng,
  }))
)}

MÖVCUD GƏZMƏLİ YERLƏR:
${JSON.stringify(
  (body.pois?.attractions || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    lat: p.lat,
    lng: p.lng,
  }))
)}

${body.days} günlük marşrut hazırla.

MÜTLƏQ RIAYƏT EDİLMƏLİ QAYDALAR:
1. ZAMAN SIRASI: Hər günün stopları
   09:00-dan başlamalı və ARDICIL getməlidir.
   09:00 → 11:00 → 13:00 → 15:00 kimi.
   Heç vaxt geriyə getmə (məs: 14:00 → 09:00 olmaz).

2. COĞRAFİ SIRA: Hər günün stopları
   coğrafi yaxınlığa görə sıralanmalıdır.
   Nearest-neighbor üsulu ilə —
   ilk stopdan ən yaxın növbəti stopa get.
   Uzaq-yaxın-uzaq-yaxın qarışığı OLMAMALIDIR.

3. VAXT HESABLAMASI:
   - Səhər başlanğıc: 09:00
   - Hər stopun müddəti (duration) verilir
   - Stoplararası yol: ortalama 20-30 dəqiqə
   - Formul: növbəti_stop_vaxtı =
     cari_vaxt + duration_dəqiqə + 25dəq
   - Nahar fasiləsi: 12:30-13:30 arası
     (restoran/kafe stopu buraya düşsün)

4. NÜMUNƏ DÜZGÜN SIRA (1 gün, 5 stop):
   09:00 - Yer A (yaxın mərkəzə)
   11:00 - Yer B (A-ya yaxın)
   13:00 - Restoran C (B-yə yaxın, nahar)
   14:30 - Yer D (C-yə yaxın)
   16:30 - Yer E (D-yə yaxın)
   18:00 - Otel F (axşam qalma)

JSON cavab ver:
{
  "summary": "qısa izah",
  "days": [
    {
      "day": 1,
      "title": "günün adı",
      "stops": [
        {
          "time": "09:00",
          "poi_id": "id",
          "name": "yer adı",
          "category": "kateqoriya",
          "duration": "2 saat",
          "duration_minutes": 120,
          "lat": 41.1997,
          "lng": 47.1706,
          "tip": "məsləhət"
        }
      ],
      "estimated_cost": "30-50 AZN",
      "notes": "qeyd"
    }
  ],
  "total_cost": "100 AZN",
  "best_time": "səhər tezdən"
}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system:
          'Sən Azərbaycan turizm ekspertisən. Yalnız verilən real yerlərdən istifadə et. Cavabı YALNIZ JSON formatında ver, başqa heç nə yazma.',
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('Claude xətası:', errText);
      return new Response(JSON.stringify({ error: 'AI xətası: ' + errText }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    const claudeData = await claudeResponse.json();
    const content = claudeData.content?.[0]?.text;

    if (!content) {
      return new Response(JSON.stringify({ error: 'Boş cavab' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Claude bəzən ```json ... ``` bloku ilə qaytarır
    // Bunu təmizləyib sonra parse et
    let cleanContent = content.trim();

    // ```json və ``` işarələrini sil
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent
        .replace(/^```\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    }

    const plan = JSON.parse(cleanContent);

    return new Response(JSON.stringify(plan), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error('Ümumi xəta:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Naməlum xəta',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
