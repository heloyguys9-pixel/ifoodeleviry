const PRODUCTS = {
  c2: { name: 'Combo Bacon Crunch', price: 30 },
  c5: { name: 'Combo Dupla', price: 45 },
  l2: { name: 'Bacon Crunch', price: 19.9 },
  l6: { name: 'Duplo Cheddar Bacon', price: 27.9 },
  l7: { name: 'Bacon Cream', price: 21.9 },
  l5: { name: 'Burger Desfiado', price: 24.9 },
  l3: { name: 'Chicken Crispy', price: 18.9 },
  p1: { name: 'Batata frita', price: 9.9 },
  p2: { name: 'Anéis de cebola', price: 11.9 },
  b1: { name: 'Refrigerante lata', price: 4 },
  b6: { name: 'Refrigerante 500ml', price: 5 },
  b5: { name: 'Água com gás 500ml', price: 2.5 },
  d1: { name: 'Brownie com Nutella', price: 16.9 }
};

function send(res, status, body) {
  return res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Método não permitido.' });
  }

  const { MISTICPAY_ACCESS_KEY_ID, MISTICPAY_ACCESS_KEY_SECRET } = process.env;
  if (!MISTICPAY_ACCESS_KEY_ID || !MISTICPAY_ACCESS_KEY_SECRET) {
    return send(res, 503, { error: 'Pagamento Pix ainda não configurado.' });
  }

  const authorization = `Basic ${Buffer.from(`${MISTICPAY_ACCESS_KEY_ID}:${MISTICPAY_ACCESS_KEY_SECRET}`).toString('base64')}`;

  try {
    if (req.body?.action === 'check') {
      const transactionId = String(req.body.transactionId || '');
      if (!/^[\w.-]{1,128}$/.test(transactionId)) {
        return send(res, 400, { error: 'Transação inválida.' });
      }

      const response = await fetch('https://api.misticpay.com/api/transactions/check', {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId })
      });
      const result = await response.json();
      if (!response.ok) return send(res, response.status, { error: result.message || 'Falha ao consultar o pagamento.' });
      return send(res, 200, { status: result.transaction?.transactionState });
    }

    if (req.body?.action !== 'create') {
      return send(res, 400, { error: 'Ação inválida.' });
    }

    const { items, customer } = req.body.order || {};
    if (!Array.isArray(items) || !items.length || items.length > 30) {
      return send(res, 400, { error: 'Itens do pedido inválidos.' });
    }
    if (!customer || typeof customer.name !== 'string' || customer.name.trim().length < 3 || !/^\d{11}$/.test(customer.document || '')) {
      return send(res, 400, { error: 'Dados do cliente inválidos.' });
    }

    let amount = 0;
    const descriptions = [];
    for (const item of items) {
      const product = PRODUCTS[item.id];
      if (!product || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) {
        return send(res, 400, { error: 'Um ou mais itens do pedido são inválidos.' });
      }
      amount += product.price * item.qty;
      descriptions.push(`${item.qty}x ${product.name}`);
    }
    amount = Math.round(amount * 100) / 100;
    if (amount < 15) return send(res, 400, { error: 'O pedido mínimo é R$ 15,00.' });

    const transactionId = `flash-${crypto.randomUUID()}`;
    const response = await fetch('https://api.misticpay.com/api/transactions/create', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        payerName: customer.name.trim(),
        payerDocument: customer.document,
        transactionId,
        description: `Pedido Flash Delivery: ${descriptions.join(', ')}`.slice(0, 200)
      })
    });
    const result = await response.json();
    if (!response.ok) return send(res, response.status, { error: result.message || 'Não foi possível gerar o Pix.' });

    const payment = result.data || {};
    const qrCode = payment.qrCodeBase64 || payment.qrcodeUrl;
    if (!payment.transactionId || !payment.copyPaste || !qrCode) {
      return send(res, 502, { error: 'A MisticPay retornou dados incompletos para o Pix.' });
    }

    return send(res, 200, {
      transactionId: payment.transactionId,
      amount,
      qrCode,
      copyPaste: payment.copyPaste
    });
  } catch (error) {
    console.error('MisticPay request failed:', error);
    return send(res, 502, { error: 'Não foi possível conectar ao serviço de pagamento.' });
  }
};