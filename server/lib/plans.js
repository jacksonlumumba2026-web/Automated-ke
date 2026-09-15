const PLANS = {
  trial: {
    name: 'Trial',
    monthlyFee: 0,
    annualFee: 0,
    setupFee: 0,
    smsQuota: 20,
    smsOverageRate: 0,
    maxContacts: 30,
    maxInventoryItems: 5,
    txnFeePercent: 0,
    features: [
      '14-day free trial',
      'Dashboard & analytics',
      'CRM (30 contacts)',
      'Portal payments',
      '20 SMS/month',
      '5 inventory items',
    ],
  },
  starter: {
    name: 'Starter',
    monthlyFee: 500,
    annualFee: 5000,
    setupFee: 1500,
    smsQuota: 50,
    smsOverageRate: 3,
    maxContacts: 100,
    maxInventoryItems: 20,
    txnFeePercent: 1.0,
    features: [
      'Dashboard & analytics',
      'CRM (100 contacts)',
      'Portal payments',
      '50 SMS/month',
      '20 inventory items',
      'Expense tracking',
      'Day 1→30 follow-ups',
    ],
  },
  business: {
    name: 'Business',
    monthlyFee: 1500,
    annualFee: 15000,
    setupFee: 2500,
    smsQuota: 200,
    smsOverageRate: 2.5,
    maxContacts: 500,
    maxInventoryItems: 100,
    txnFeePercent: 0.75,
    features: [
      'All Starter features',
      'CRM (500 contacts)',
      '200 SMS/month',
      '100 inventory items',
      'Weekly summary SMS to owner',
      'Hourly low-stock SMS alerts',
    ],
  },
  pro: {
    name: 'Pro',
    monthlyFee: 3000,
    annualFee: 30000,
    setupFee: 3500,
    smsQuota: 500,
    smsOverageRate: 2,
    maxContacts: 2000,
    maxInventoryItems: -1,
    txnFeePercent: 0.5,
    features: [
      'All Business features',
      'CRM (2,000 contacts)',
      '500 SMS/month',
      'Unlimited inventory items',
      'Priority support',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    monthlyFee: 5000,
    annualFee: 50000,
    setupFee: 5000,
    smsQuota: -1,
    smsOverageRate: 0,
    maxContacts: -1,
    maxInventoryItems: -1,
    txnFeePercent: 0.25,
    features: [
      'All Pro features',
      'Unlimited contacts',
      'Unlimited SMS',
      'Lowest transaction fee (0.25%)',
      'Dedicated support line',
      'Custom portal branding',
    ],
  },
};

// Backward-compat alias
PLANS.growth = { ...PLANS.business, name: 'Growth' };

function getPlan(planId) {
  return PLANS[planId] || PLANS.starter;
}

// Returns true if current count is within the limit (-1 = unlimited)
function withinLimit(current, max) {
  return max === -1 || current < max;
}

module.exports = { PLANS, getPlan, withinLimit };
