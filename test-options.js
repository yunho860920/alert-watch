const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const url = 'https://cuddlybunny.co.kr/product/detail.html?product_no=1920&cate_no=26&display_group=1';
  const keyword = '품절';
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    const html = response.data;
    const $ = cheerio.load(html);
    
    console.log('--- ALL SELECT ELEMENTS ---');
    $('select').each((i, el) => {
      console.log(`Select #${i}: class="${$(el).attr('class')}", id="${$(el).attr('id')}"`);
      const options = $(el).find('option');
      options.each((j, opt) => {
        console.log(`  Option #${j}: value="${$(opt).attr('value')}", text="${$(opt).text().trim()}"`);
      });
    });
  } catch (err) {
    console.error(err);
  }
}

test();
