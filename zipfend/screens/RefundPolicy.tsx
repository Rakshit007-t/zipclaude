import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Button, Breadcrumbs } from '../components/ui';

interface PolicySection {
  icon: string;
  title: string;
  content: string[];
}

const POLICY_SECTIONS: PolicySection[] = [
  {
    icon: 'subscriptions',
    title: '1. ZipRIGHT Digital Subscriptions & Upgrades',
    content: [
      '• 7-Day Cooling-Off Period: If you purchase a paid ZipRIGHT subscription (Starter, Pro, or Elite) and have not performed more than three (3) AI virtual try-on renders or size recommendations under the paid tier, you are entitled to a full refund within seven (7) calendar days of initial purchase.',
      '• Cancellation Anytime: You may cancel recurring plan renewals at any time via Settings > Subscriptions or by emailing refunds@zipright.in. Your access remains active until the end of your prepaid billing period.',
      '• Non-Refundable Items: Once AI compute cycles (HD or Max virtual try-on renders) have been successfully processed, the associated compute cost is non-refundable.',
      '• Technical Failure Credit: If a technical error or server failure prevents your virtual try-on from rendering, your account credit or token will be reinstated automatically without deducting from your quota.',
    ],
  },
  {
    icon: 'storefront',
    title: '2. Third-Party Marketplace & Affiliate Purchases',
    content: [
      '• Intermediary Role: ZipRIGHT operates as an AI sizing discovery platform and technology intermediary under Section 79 of the Information Technology Act, 2000. When you click outward links to purchase garments from third-party retailers (such as brand stores, e-commerce partners, or marketplace sellers), the sales transaction occurs directly between you and the retailer.',
      '• Retailer Return Policies: Returns, size exchanges, replacements, and refunds for physical apparel items are governed exclusively by the respective retailer’s terms of service and return windows (e.g. 7-day, 14-day, or 30-day merchant windows).',
      '• Size Mismatch Assistance: If an item bought through our recommendation does not fit, our support team can help you identify whether the retailer uses custom brand sizing and assist you in initiating the merchant’s exchange process.',
    ],
  },
  {
    icon: 'payments',
    title: '3. Payment Processing & Refund Timelines',
    content: [
      '• Method of Refund: All eligible refunds for direct in-app transactions or digital services will be credited back strictly to the original payment method (Credit/Debit Card, UPI, Net Banking, or Digital Wallet) via our authorized payment processor (Razorpay).',
      '• Turnaround Time: Refunds are approved and processed within 2 to 3 business days of verification. Depending on your issuing bank or payment provider, funds typically reflect in your account within 5 to 7 business days.',
      '• Cash on Delivery / Offline Payments: Direct cash refunds are not offered. Any approved compensation will be issued as in-app credits or direct bank transfer upon verifiable KYC submission.',
    ],
  },
  {
    icon: 'verified_user',
    title: '4. Consumer Protection Compliance',
    content: [
      '• In accordance with the Consumer Protection (E-Commerce) Rules, 2020 and the Consumer Protection Act, 2019 (India):',
      '• We do not impose unreasonable cancellation fees on users who cancel before service fulfillment.',
      '• We clearly state all fees, taxes, and service parameters before you confirm any payment.',
      '• Chargeback Inquiries: If you notice an unauthorized charge on your card originating from ZipRIGHT, please notify security@zipright.in immediately so we can investigate and facilitate a prompt reversal prior to bank dispute filing.',
    ],
  },
  {
    icon: 'support_agent',
    title: '5. How to Request a Refund or Dispute an Order',
    content: [
      'To request a refund or raise a billing grievance, please submit the following details:',
      '1. Your registered ZipRIGHT account email and phone number.',
      '2. The transaction ID or invoice number (provided in your confirmation email).',
      '3. A clear explanation of the issue or error encountered.',
      'Send your request to: refunds@zipright.in | Subject: Refund Request - [Transaction ID]',
      'Our customer care team will acknowledge your request within 48 business hours and resolve it within 14 calendar days.',
    ],
  },
];

const RefundPolicy: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Refund Policy" headingTag="span" subtitle="Effective April 2026" onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="px-6 pt-6 pb-6 max-w-2xl mx-auto w-full">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Settings', href: '/settings' },
            { label: 'Refund Policy' },
          ]}
          className="mb-4"
        />
        <Eyebrow className="mb-3">Fair &amp; Transparent</Eyebrow>
        <h1 className="font-display text-[30px] leading-tight font-light mb-4">
          Refunds &amp; <em className="font-medium text-brand">Returns.</em>
        </h1>
        <p className="text-[13.5px] text-ink-soft leading-relaxed mb-6">
          We want you to feel completely confident when using ZipRIGHT. This policy sets out clear, transparent rules regarding cancellations, digital service refunds, and third-party marketplace returns.
        </p>

        {/* Highlight cards */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {[
            { icon: 'schedule', label: '7-Day Window' },
            { icon: 'credit_card', label: '5-7 Day Payout' },
            { icon: 'verified', label: 'Zero Hidden Fees' },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-surface-1 border border-line rounded-card p-3 flex flex-col items-center gap-1.5 text-center"
            >
              <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-soft leading-tight">
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Contact Support Pill */}
        <div className="rounded-card border border-line bg-surface-1 p-4 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-[13.5px] font-semibold text-ink">Need help with a charge?</p>
            <p className="text-[11.5px] text-ink-soft mt-0.5">Contact our billing team directly.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (window.location.href = 'mailto:refunds@zipright.in?subject=Billing%20Support%20Inquiry')}
            icon="mail"
          >
            Email Support
          </Button>
        </div>
      </div>

      {/* Sections Accordion */}
      <div className="px-6 pb-24 flex flex-col gap-3">
        <Eyebrow className="ml-1 mb-2">Policy Details</Eyebrow>
        {POLICY_SECTIONS.map((section, idx) => {
          const open = expanded === idx;
          return (
            <div key={idx} className="border-b border-line">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-4 py-4 text-left"
                onClick={() => setExpanded(open ? null : idx)}
                aria-expanded={open}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px] text-brand shrink-0" aria-hidden="true">
                    {section.icon}
                  </span>
                  <span className="text-[13.5px] font-medium text-ink leading-snug">{section.title}</span>
                </div>
                <span
                  className="material-symbols-outlined text-[18px] text-ink-faint flex-shrink-0 transition-transform duration-200"
                  style={{ transform: open ? 'rotate(180deg)' : 'none' }}
                  aria-hidden="true"
                >
                  expand_more
                </span>
              </button>
              {open && (
                <div className="pb-5 pl-7 pr-2 flex flex-col gap-2.5">
                  {section.content.map((p, i) => (
                    <p key={i} className="text-[13px] text-ink-soft leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RefundPolicy;
