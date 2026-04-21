import React, { useState, useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { Mail, Shield, AlertCircle, TrendingUp, LogOut, CheckCircle2, Clock, Inbox, Search, Filter, Layers, MessageSquare } from 'lucide-react';
import { Email, ContactNode, ContactLink } from './types';
import { cn, formatGmailDate, parseEncodedEmail } from './lib/utils';
import RelationshipGraph from './components/RelationshipGraph';
import { motion, AnimatePresence } from 'motion/react';

function MainApp() {
    const { isAuthenticated, login, logout } = useAuth();
    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
    const [filter, setFilter] = useState<string>('all');
    const [view, setView] = useState<'inbox' | 'analytics'>('inbox');
    const [classificationProgress, setClassificationProgress] = useState({ total: 0, count: 0, isCoolingDown: false });
    const [isClassifying, setIsClassifying] = useState(false);

    const fetchEmails = async () => {
        if (loading || isClassifying) return; // Prevent concurrent fetches/classification
        
        setLoading(true);
        try {
            const res = await fetch('/api/gmail/messages');
            if (res.status === 401) return;
            
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to fetch');
            }
            
            const data = await res.json();
            
            const processed: Email[] = data.map((msg: any) => {
                const headers = msg.payload?.headers || [];
                return {
                    id: msg.id,
                    threadId: msg.threadId,
                    subject: headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)',
                    from: headers.find((h: any) => h.name === 'From')?.value || 'Unknown',
                    to: headers.find((h: any) => h.name === 'To')?.value || 'Unknown',
                    date: headers.find((h: any) => h.name === 'Date')?.value || '',
                    snippet: msg.snippet || '',
                    interactionContext: msg.interactionContext // From server deep scan
                };
            });

            setEmails(processed);
            
            // 3. Classify via Server Proxy (Serial with Delay)
            const classifySequentially = async (toClassify: Email[]) => {
                if (isClassifying) return;
                setIsClassifying(true);
                
                setClassificationProgress({ total: toClassify.length, count: 0, isCoolingDown: false });
                let completed = 0;

                for (const email of toClassify) {
                    try {
                        const res = await fetch('/api/gmail/classify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                subject: email.subject,
                                snippet: email.snippet,
                                from: email.from,
                                interactionCount: email.interactionContext?.count || 1,
                                isFrequentContact: email.interactionContext?.isFrequent || false
                            })
                        });
                        
                        if (!res.ok) {
                            const error = await res.json();
                            if (res.status === 429) {
                                console.warn("Quota exceeded, sitting out for 45s...");
                                setClassificationProgress(prev => ({ ...prev, isCoolingDown: true }));
                                await new Promise(r => setTimeout(r, 45000)); // Wait 45s on backoff
                                setClassificationProgress(prev => ({ ...prev, isCoolingDown: false }));
                                continue; 
                            }
                            throw new Error(error.error || 'Classification failed');
                        }
                        
                        const classification = await res.json();
                        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, classification } : e));
                        
                        completed++;
                        setClassificationProgress(prev => ({ ...prev, count: completed, isCoolingDown: false }));

                        // Safety Delay (8s) to stay well under 15 RPM Free Tier limit
                        await new Promise(r => setTimeout(r, 8000));
                    } catch (err) {
                        console.error("BG Classification Error:", err);
                        if (err instanceof Error && err.message.includes('Quota')) {
                             setClassificationProgress({ total: 0, count: 0, isCoolingDown: false });
                             setIsClassifying(false);
                             return;
                        }
                    }
                }
                setClassificationProgress({ total: 0, count: 0, isCoolingDown: false });
                setIsClassifying(false);
            };

            classifySequentially(processed);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) fetchEmails();
    }, [isAuthenticated]);

    const filteredEmails = useMemo(() => {
        if (filter === 'all') return emails;
        if (filter === 'important') {
            // Priority Inbox includes high priority OR specific category
            return emails.filter(e => 
                e.classification?.category === 'important' || 
                e.classification?.priority === 'high'
            );
        }
        return emails.filter(e => e.classification?.category === filter);
    }, [emails, filter]);

    const graphData = useMemo(() => {
        const contactCounts: Record<string, number> = {};
        const connections: Record<string, number> = {};
        
        emails.forEach(e => {
            const sender = parseEncodedEmail(e.from);
            contactCounts[sender] = (contactCounts[sender] || 0) + 1;
        });

        const nodes: ContactNode[] = Object.entries(contactCounts).map(([email, count]) => ({
            id: email, email, count
        }));

        // For demo purposes, we connect all emails to "me"
        const links: ContactLink[] = nodes.map(n => ({
            source: n.id,
            target: 'ME',
            value: n.count
        }));

        if (nodes.length > 0) nodes.push({ id: 'ME', email: 'me@itriage.com', count: emails.length });

        return { nodes, links };
    }, [emails]);

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-slate-900">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-md w-full bg-white border border-slate-200 p-8 rounded-2xl shadow-xl shadow-slate-200/50"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-blue-200">
                            <Mail size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Triage.AI</h1>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Intelligent Email Assistant</p>
                        </div>
                    </div>
                    <p className="text-slate-600 mb-8 leading-relaxed">
                        Securely analyze, categorize, and graph your email communication patterns using state-of-the-art AI.
                    </p>
                    <button 
                        onClick={login}
                        className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 group"
                    >
                        <span>Connect Google Workspace</span>
                        <TrendingUp size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                    <div className="mt-8 flex items-center justify-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <div className="flex items-center gap-1.5"><Shield size={12} className="text-slate-300" /><span>Secure OAuth</span></div>
                        <div className="w-1 h-1 bg-slate-200 rounded-full" />
                        <div className="flex items-center gap-1.5"><Inbox size={12} className="text-slate-300" /><span>No Data Stored</span></div>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans overflow-hidden">
            {/* Header */}
            <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-30">
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">T</div>
                        <span className="font-bold text-slate-800 tracking-tight">Triage.AI</span>
                    </div>
                    
                    <nav className="flex gap-1">
                        <button 
                            onClick={() => setView('inbox')}
                            className={cn(
                                "text-xs font-bold uppercase py-1.5 px-4 rounded-md transition-all",
                                view === 'inbox' ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "text-slate-500 hover:bg-slate-100"
                            )}
                        >
                            Inbox
                        </button>
                        <button 
                            onClick={() => setView('analytics')}
                            className={cn(
                                "text-xs font-bold uppercase py-1.5 px-4 rounded-md transition-all",
                                view === 'analytics' ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "text-slate-500 hover:bg-slate-100"
                            )}
                        >
                            Intelligence
                        </button>
                    </nav>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">System Status</div>
                            <div className="text-xs font-bold text-emerald-600 flex items-center gap-1 justify-end">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                Active
                            </div>
                        </div>
                        <div className="w-px h-8 bg-slate-200" />
                        <div className="text-right">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Inbox Density</div>
                            <div className="text-xs font-bold text-slate-800">{emails.length} Messages</div>
                        </div>
                    </div>
                    <button onClick={logout} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">
                        <LogOut size={16} />
                    </button>
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {view === 'inbox' ? (
                    <>
                        {/* Sidebar */}
                        <aside className="w-56 border-r border-slate-200 bg-white flex flex-col shrink-0 overflow-y-auto">
                            <div className="p-4 space-y-6">
                                <div>
                                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-3">Folders</h3>
                                    <div className="space-y-1">
                                        {[
                                            { id: 'all', icon: Inbox, label: 'Everything', color: 'slate' },
                                            { id: 'important', icon: Shield, label: 'Priority Inbox', color: 'blue' },
                                            { id: 'promotional', icon: Layers, label: 'Commercial', color: 'amber' },
                                            { id: 'notifications', icon: MessageSquare, label: 'System Logs', color: 'indigo' },
                                            { id: 'spam', icon: AlertCircle, label: 'Junk/Spam', color: 'red' },
                                        ].map(item => (
                                            <button 
                                                key={item.id}
                                                onClick={() => setFilter(item.id)}
                                                className={cn(
                                                    "w-full flex items-center justify-between p-2 rounded-md transition-all group",
                                                    filter === item.id 
                                                        ? "bg-blue-50 text-blue-700 font-semibold" 
                                                        : "text-slate-600 hover:bg-slate-50"
                                                )}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <item.icon size={16} className={cn(
                                                        filter === item.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                                                    )} />
                                                    <span className="text-sm">{item.label}</span>
                                                </div>
                                                {filter === item.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-3">AI Model State</h3>
                                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "w-2 h-2 rounded-full", 
                                                    classificationProgress.isCoolingDown ? "bg-amber-500 animate-pulse" :
                                                    classificationProgress.total > 0 ? "bg-blue-500 animate-pulse" : "bg-emerald-500"
                                                )}></div>
                                                <span className="text-[11px] font-bold text-slate-600">Gemini-3-Flash</span>
                                            </div>
                                            {classificationProgress.total > 0 && (
                                                <span className={cn(
                                                    "text-[10px] font-mono font-bold",
                                                    classificationProgress.isCoolingDown ? "text-amber-600" : "text-blue-600"
                                                )}>
                                                    {Math.round((classificationProgress.count / classificationProgress.total) * 100)}%
                                                </span>
                                            )}
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-2">
                                            <motion.div 
                                                className={cn(
                                                    "h-full transition-all duration-500",
                                                    classificationProgress.isCoolingDown ? "bg-amber-500" :
                                                    classificationProgress.total > 0 ? "bg-blue-600" : "bg-emerald-500"
                                                )}
                                                initial={{ width: "3/4" }}
                                                animate={{ 
                                                    width: classificationProgress.total > 0 
                                                        ? `${(classificationProgress.count / classificationProgress.total) * 100}%` 
                                                        : "100%" 
                                                }}
                                            />
                                        </div>
                                        <div className={cn(
                                            "text-[9px] font-bold uppercase",
                                            classificationProgress.isCoolingDown ? "text-amber-600 animate-pulse" : "text-slate-400"
                                        )}>
                                            {classificationProgress.isCoolingDown 
                                                ? "Quota Pause: Waiting 45s..." 
                                                : classificationProgress.total > 0 
                                                ? `Analyzing: ${classificationProgress.count}/${classificationProgress.total}` 
                                                : "Classification Thread: Ready"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </aside>

                        {/* List Partition */}
                        <section className="flex-1 flex flex-col bg-slate-50 border-r border-slate-200 overflow-hidden">
                            <div className="h-14 px-6 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white/60 backdrop-blur-xl">
                                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Queue Analysis ({filteredEmails.length})</h2>
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input className="bg-slate-100 pl-9 pr-4 py-1.5 border-none rounded-md text-xs w-48 focus:ring-2 focus:ring-blue-500/10 transition-all" placeholder="Search insights..." />
                                    </div>
                                    <button onClick={fetchEmails} className={cn(
                                        "p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all",
                                        loading ? "animate-spin text-blue-600" : ""
                                    )}>
                                        <Clock size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-1">
                                {loading && emails.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center p-12 space-y-4">
                                        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Synchronizing Workspace...</p>
                                    </div>
                                ) : (
                                    <AnimatePresence initial={false}>
                                        {filteredEmails.map(email => (
                                            <motion.div 
                                                key={email.id}
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                onClick={() => setSelectedEmail(email)}
                                                className={cn(
                                                    "group p-3 cursor-pointer rounded-xl transition-all border flex items-center gap-4 relative overflow-hidden",
                                                    selectedEmail?.id === email.id 
                                                        ? "bg-white border-blue-200 shadow-lg shadow-blue-100/50" 
                                                        : "bg-transparent border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm"
                                                )}
                                            >
                                                {selectedEmail?.id === email.id && (
                                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600" />
                                                )}
                                                
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-[11px] font-bold text-slate-800 truncate">{parseEncodedEmail(email.from)}</span>
                                                        <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-500">{formatGmailDate(email.date)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h4 className="text-xs font-bold text-slate-900 truncate flex-1">{email.subject}</h4>
                                                        {email.classification && (
                                                            <span className={cn(
                                                                "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded leading-none shrink-0",
                                                                email.classification.category === 'important' ? "bg-emerald-100 text-emerald-700" :
                                                                email.classification.category === 'promotional' ? "bg-amber-100 text-amber-700" :
                                                                email.classification.category === 'spam' ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                                                            )}>
                                                                {email.classification.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-500 truncate leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity italic">
                                                        "AI: {email.classification?.summary || email.snippet.substring(0, 50) + '...'}"
                                                    </p>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                )}
                            </div>
                        </section>

                        {/* Inspector Partition */}
                        <section className="w-[450px] bg-white border-l border-slate-200 hidden xl:flex flex-col overflow-hidden">
                            <AnimatePresence mode="wait">
                                {selectedEmail ? (
                                    <motion.div 
                                        key={selectedEmail.id}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="flex-1 flex flex-col overflow-hidden"
                                    >
                                        <div className="h-14 flex items-center justify-between px-6 border-b border-slate-200 bg-slate-50/50 shrink-0">
                                            <div className="flex gap-2">
                                                <button className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"><CheckCircle2 size={16} /></button>
                                                <button className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"><Clock size={16} /></button>
                                                <button className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><AlertCircle size={16} /></button>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Message Detail</span>
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-8 space-y-8">
                                            <div>
                                                <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight mb-4">{selectedEmail.subject}</h1>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 uppercase">
                                                        {selectedEmail.from[0]}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-bold text-slate-800">{parseEncodedEmail(selectedEmail.from)}</div>
                                                        <div className="text-[11px] text-slate-400 font-medium">To: {parseEncodedEmail(selectedEmail.to)}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {selectedEmail.classification ? (
                                                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 relative overflow-hidden">
                                                    <div className="absolute right-4 top-4 opacity-5">
                                                        <Layers size={80} />
                                                    </div>
                                                    <div className="flex items-center gap-2 mb-6">
                                                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Intelli-Triage Report</h3>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-3 mb-6">
                                                        <div className="bg-white p-3 rounded-xl border border-slate-200/50 shadow-sm">
                                                            <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Impact Score</div>
                                                            <div className="text-lg font-bold text-slate-800 flex items-baseline gap-1">
                                                                {selectedEmail.classification.impactScore.toFixed(1)}
                                                                <span className="text-[10px] text-slate-400 font-medium">/ 10</span>
                                                            </div>
                                                        </div>
                                                        <div className="bg-white p-3 rounded-xl border border-slate-200/50 shadow-sm">
                                                            <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">State Action</div>
                                                            <div className="text-xs font-bold text-slate-800 uppercase italic">
                                                                {selectedEmail.classification.actionRequired ? '⚡ Manual Review' : '💨 Auto-Archive'}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4">
                                                        <div>
                                                            <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1">AI Classification</h4>
                                                            <div className="flex gap-2">
                                                                <span className="bg-white px-2 py-1 rounded border border-slate-200 text-[11px] font-bold text-slate-700 capitalize">
                                                                    {selectedEmail.classification.category}
                                                                </span>
                                                                <span className={cn(
                                                                    "px-2 py-1 rounded border text-[11px] font-bold capitalize",
                                                                    selectedEmail.classification.priority === 'high' ? "bg-red-50 border-red-100 text-red-700" : "bg-white border-slate-200 text-slate-700"
                                                                )}>
                                                                    {selectedEmail.classification.priority} Priority
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1">Summarized Content</h4>
                                                            <p className="text-xs font-medium text-slate-700 leading-relaxed bg-white/50 p-3 rounded-lg border border-slate-100">
                                                                "{selectedEmail.classification.summary}"
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-8 border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center space-y-3">
                                                    <div className="w-10 h-10 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Analyzing Semantic Load...</p>
                                                </div>
                                            )}

                                            <div className="border-t border-slate-100 pt-8">
                                                <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-4 tracking-widest">Original Feed</h4>
                                                <p className="text-xs text-slate-600 leading-relaxed font-medium bg-slate-50 p-4 rounded-xl whitespace-pre-wrap">
                                                    {selectedEmail.snippet}
                                                </p>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40 grayscale group">
                                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-500">
                                            <Mail size={32} className="text-slate-400" />
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-800 tracking-tight uppercase">Thread Inspector</h3>
                                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">Select a queue item for deep analysis</p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </section>
                    </>
                ) : (
                    /* Intelligence View */
                    <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
                        <div className="max-w-6xl mx-auto space-y-8">
                            <div className="flex items-end justify-between border-b border-slate-200 pb-8">
                                <div>
                                    <h1 className="text-3xl font-black text-slate-800 tracking-tight mb-2">Communication Topography</h1>
                                    <p className="text-sm text-slate-500 font-medium">Visualizing sender relevance and interaction volume based on system metadata.</p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase">AI Load</div>
                                        <div className="text-sm font-bold text-blue-600 italic">Optimized</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <div className="lg:col-span-2 space-y-4">
                                    <RelationshipGraph nodes={graphData.nodes} links={graphData.links} />
                                    <div className="flex items-center gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-600 rounded-full" /><span>Frequent Interaction</span></div>
                                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-slate-800 rounded-full" /><span>Your Identity</span></div>
                                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-slate-300 rounded-full" /><span>Low Relevance</span></div>
                                    </div>
                                </div>
                                
                                <div className="space-y-6">
                                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl shadow-slate-200/50">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">High Tension Contacts</h3>
                                        <div className="space-y-4">
                                            {graphData.nodes.filter(n => n.id !== 'ME').sort((a,b) => b.count - a.count).slice(0, 5).map((node, i) => (
                                                <div key={node.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 overflow-hidden group hover:border-blue-200 transition-all">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold",
                                                            i === 0 ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-500"
                                                        )}>
                                                            {node.email[0].toUpperCase()}
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-700 truncate w-32">{parseEncodedEmail(node.email)}</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">{node.count}x</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-slate-900 rounded-2xl p-6 text-white relative overflow-hidden shadow-2xl shadow-slate-900/20">
                                        <div className="absolute top-0 right-0 p-4 opacity-10">
                                            <Shield size={60} />
                                        </div>
                                        <h3 className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-4">Deep Learning Insight</h3>
                                        <p className="text-xs leading-relaxed font-medium text-slate-300 mb-6">
                                            "Interaction with <span className="font-bold text-white underline decoration-blue-500 underline-offset-4">{graphData.nodes.filter(n => n.id !== 'ME')[0]?.id || 'your contacts'}</span> is significantly higher than average. Triage recommends marking as a Direct Contact."
                                        </p>
                                        <button className="w-full py-2 bg-blue-600 text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20">
                                            Adjust Constraints
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="h-10 border-t border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Internal API: Local-01-Sync</span>
                    </div>
                    <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Classification Model: gemini-3-flash</div>
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    IntelliMail © 2026 • v2.2.0 • High Density Refined
                </div>
            </footer>
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <MainApp />
        </AuthProvider>
    );
}
