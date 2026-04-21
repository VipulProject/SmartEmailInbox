import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { ContactNode, ContactLink } from '../types';

interface Props {
    nodes: ContactNode[];
    links: ContactLink[];
}

export default function RelationshipGraph({ nodes, links }: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = 400;

        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', [0, 0, width, height]);

        svg.selectAll('*').remove();

        const simulation = d3.forceSimulation(nodes as any)
            .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2));

        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', '#cbd5e1')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', (d: any) => Math.sqrt(d.value) * 2);

        const node = svg.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .call(d3.drag<any, any>()
                .on('start', (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event: any, d: any) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }));

        node.append('circle')
            .attr('r', (d: any) => Math.sqrt(d.count) * 5 + 5)
            .attr('fill', (d: any) => d.id === 'ME' ? '#1e293b' : '#3b82f6')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2);

        node.append('text')
            .text((d: any) => d.id === 'ME' ? 'YOU' : d.id.split('@')[0])
            .attr('x', 12)
            .attr('y', 4)
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .attr('fill', '#64748b');

        simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        });

        return () => simulation.stop();
    }, [nodes, links]);

    return (
        <div ref={containerRef} className="w-full h-[400px] bg-slate-50 rounded-xl border border-dashed border-slate-300 overflow-hidden relative">
            <svg ref={svgRef} className="w-full h-full p-4" />
            <div className="absolute bottom-2 right-2 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Graph v2.1-beta</div>
        </div>
    );
}
